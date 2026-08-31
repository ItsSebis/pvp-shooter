/**
 * Crypto-secure random helpers. Math.random() is disallowed for anything gameplay-affecting
 * per Cloudflare Workers best practices (predictable, non-cryptographic) — projectile spread
 * uses these instead so shot outcomes can't be predicted/manipulated by a client that has
 * somehow observed the RNG stream.
 */

/** Uniform random float in [min, max). */
export function randomFloat(min: number, max: number): number {
	const buf = new Uint32Array(1);
	crypto.getRandomValues(buf);
	const unit = buf[0] / 0x1_0000_0000; // buf[0] in [0, 2^32); unit in [0, 1)
	return min + unit * (max - min);
}

/** Uniform random float in [-magnitude, magnitude]. Used for symmetric weapon spread. */
export function randomSymmetric(magnitude: number): number {
	return randomFloat(-magnitude, magnitude);
}
