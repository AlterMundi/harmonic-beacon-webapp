import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import sharp from 'sharp';

const require = createRequire(import.meta.url);
for (const format of ['jpeg', 'avif']) {
    const encoded = await sharp({
        create: { width: 8, height: 8, channels: 3, background: '#4080ff' },
    }).toFormat(format).toBuffer();
    const decoded = await sharp(encoded).raw().toBuffer({ resolveWithObject: true });
    assert.equal(decoded.info.width, 8);
    assert.equal(decoded.info.height, 8);
    assert.equal(decoded.data.length, 8 * 8 * decoded.info.channels);
    assert.ok(decoded.data.some((value) => value > 0));
    console.log(`${format}: native encode/decode passed`);
}
console.log(JSON.stringify({
    platform: process.platform, arch: process.arch,
    next: require('next/package.json').version,
    sharp: sharp.versions.sharp, heif: sharp.versions.heif,
}));
