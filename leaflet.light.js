L.Light = L.SemiCircle.extend({
	options:{
		realDistance: 1852,
		useRealDistance: true
	},

	setColor: function(color) {
		if (this._color !== color) {
			this._color = color;
			L.Path.prototype.setStyle.call(this, {fill: !!color, fillColor: color});
		}
	},
	setUseRealDistance: function(b) {
		if(b != this.useRealDistance){
			if(b)
				this.setRadius(this.options.realDistance);
			else
				this.setRadius(this.options.realDistance*0.1);
			this.useRealDistance = b;
		}
	}
});

L.Light.sequence = function(tags, randOffset, fallbackColor = '#FF0') {
	let character = tags['seamark:light:character'] || 'Fl';
	
	let colors = (tags['seamark:light:colour'] || fallbackColor).split(';');

	let sequence = tags['seamark:light:sequence'] || '1+(1)';
	
	if (character.match(/^Al\./)) {// Alternating color!
		character = tags['seamark:light:character'].substring(3);

		if (character == 'Iso' && sequence && sequence.match(/^\d+$/))
			sequence = sequence + '+(' + sequence + ')';
	}

	if (character == 'Iso' && !sequence && 'seamark:light:period' in tags) {
		const period = parseFloat(tags['seamark:light:period'], 10);
		sequence = (period / 2) + '+(' + (period / 2) + ')';
	}

	// For those Flashing lights that have a single number sequence
	if (character.match(/^Fl|FI|LFl|IQ$/) && sequence.match(/^\d+$/)) {
		const flash = parseFloat(sequence)
		const remainder = 'seamark:light:period' in tags ? (parseFloat(tags['seamark:light:period']) - flash) : flash;
		character = 'Fl';
		sequence = flash + '+(' + remainder + ')';
	}

	// Convert FFl to Fl
	if (character == 'FFl' && sequence.match(/^\d+$/) && tags['seamark:light:period'].match(/^\d+$/)) {
		character = 'Fl';
		sequence = parseFloat(sequence, 10) + '+(' + (parseFloat(tags['seamark:light:period'], 10) - parseFloat(sequence, 10)) + ')';
	}

	// Convert Q with Q+LFL sequence to Fl
	if (character.match(/^Q|VQ|UQ$/) && 'seamark:light:period' in tags && sequence.match(/^Q(\(\d+\))?\s*\+\s*LFL/)) {
		let qlfl = sequence.match(/^Q(\((\d+)\))?\s*\+\s*LFL/);
		const period = parseFloat(tags['seamark:light:period']);
		const short = parseFloat(qlfl[2] || tags['seamark:light:group'] || 1);
		const long = 1;
		const flash = 0.2;
		const longflash = 1.0;
		const remainder = period - (short * 2 * flash + longflash)
		
		if (remainder < 0)
			throw 'Could not convert Q+LFL to Fl: negative remainder';

		character = 'Fl';
		sequence = Array(short).fill(flash + '+(' + flash + ')').join('+') + '+' + longflash + '+(' + remainder + ')';
	}

	// Convert simple quick flashes which indicates how many with group and the total duration of that group with sequence into Fl.
	if (character.match(/^Q|VQ|UQ$/) && sequence.match(/^\d$/) && 'seamark:light:group' in tags) {
		const short = parseFloat(tags['seamark:light:group']);
		const flash = parseFloat(sequence) / short / 2;
		character = 'Fl';
		sequence = Array(short).fill(flash + '+(' + flash + ')').join('+');
	}

	// Remove the 'second' suffix
	sequence = sequence.replace(/s$/, '');

	switch (character) {
		case 'F': // Fixed Light
			return new L.Light.Fixed(colors[0]);

		case 'Iso':
			return new L.Light.CombinedSequence(colors.map(color => {
				return new L.Light.Sequence(sequence, randOffset, color);
			}), randOffset);

		case 'Oc': // Occulting Light
		case 'Fl': // Flashing Light
		case 'FI': // Mistyped Fl
		case 'LFl': // Long Flash Light
		case 'Q': // Quick Flashing Light
		case 'VQ': // Very quick flashing
		case 'UQ': // Ultra quick
		case 'Mo':
			if (!sequence || sequence.match(/^\d+$/))
				throw 'Unexpected sequence: ' + sequence;

			const sequences = sequence.split(',').map((sequence, i) => {
				let color = colors[i % colors.length];

				// Does the sequence start with the color?
				let letter = sequence.match(/^\[([A-Z]+)\.\](.+)$/);
				if (letter) {
					const expr = new RegExp('^' + letter[1], 'i');
					color = colors.find(color => color.match(expr));
					sequence = letter[2];
				}

				return new L.Light.Sequence(sequence, randOffset, color);
			});

			if (sequences.length < colors.length)
				console.warn('There are fewer sequences than colors', {character, sequence, colors}, tags);

			return new L.Light.CombinedSequence(sequences, randOffset);
	 
	 	default:
			throw 'Unknown character: ' + character
	}
}

L.Light.Fixed = class {
	constructor(color) {
		this.color = color;
	}

	state(time) {
		return this.color;
	}
}

L.Light.CombinedSequence = class {
	constructor(sequences, randOffset) {
		this.sequences = sequences;

		this.sequences.forEach(sequence => {
			sequence.offset = 0;
		});

		this.duration = this.sequences.reduce((sum, seq) => sum + seq.duration, 0);

		this.offset = randOffset * this.duration;
	}

	state(time) {
		let dt = (this.offset + time) % this.duration;
		let i = 0;

		while (dt > this.sequences[i].duration) {
			dt -= this.sequences[i++].duration;
		}

		return this.sequences[i].state(dt);
	}
}

L.Light.Sequence = class {
	constructor(seq, randOffset, color=true) {
		this.setSequence(seq, randOffset, color);
	}

	setSequence(seq, randOffset, color) {
		this.text = seq;

		this.steps = seq.replace(/\s/g, '').split('+').map(step => {
			let state = color;
			if (/^\(\d+(\.\d+)?\)$/.test(step)) {
				state = false;
				step = step.substring(1, step.length - 1);
			}
			return [state, parseFloat(step.replace(',', '.'), 10)];
		});

		this.duration = this.steps.reduce((sum, step) => sum + step[1], 0);

		if (isNaN(this.duration))
			throw 'Cannot parse sequence "' + this.text + '"';

		this.offset = randOffset * this.duration;
	}

	state(time) {
		let dt = (this.offset + time) % this.duration;

		for (let i = 0; i < this.steps.length; ++i) {
			if (dt < this.steps[i][1])
				return this.steps[i][0];
			else
				dt -= this.steps[i][1];
		}
		throw new Error('Ran out of steps while still inside duration?');
	}
}