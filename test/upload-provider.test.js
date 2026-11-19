import test from 'node:test';
import assert from 'node:assert/strict';
import { uploadToImgBB } from '../src/services/upload.js';

test('image provider sends multipart data and returns a trusted image URL', async () => {
  const url = await uploadToImgBB('image-bytes', { key: 'test-key', fetcher: async (endpoint, options) => {
    assert.equal(endpoint, 'https://api.imgbb.com/1/upload');
    assert.equal(options.method, 'POST');
    assert.equal(options.body.get('key'), 'test-key');
    assert.equal(options.body.get('image'), 'image-bytes');
    assert.ok(options.signal instanceof AbortSignal);
    return { ok: true, json: async () => ({ success: true, data: { url: 'https://i.ibb.co/test/photo.png' } }) };
  } });
  assert.equal(url, 'https://i.ibb.co/test/photo.png');
});

test('provider errors and malformed URLs produce safe retryable errors', async () => {
  const responses = [
    { ok: false, json: async () => ({ error: 'private provider details' }) },
    { ok: true, json: async () => { throw new SyntaxError('private response'); } },
    ...['https://evil.example/a.png', 'https://i.ibb.co.evil.example/a.png', 'https://user:secret@i.ibb.co/a.png', 'http://i.ibb.co/a.png', 'https://i.ibb.co:8443/a.png', null].map(url => ({ ok: true, json: async () => ({ success: true, data: { url } }) })),
  ];
  for (const response of responses) await assert.rejects(uploadToImgBB('image', { key: 'test-key', fetcher: async () => response }), { status: 502, message: 'Image upload is unavailable. Please try again.' });
  await assert.rejects(uploadToImgBB('image', { key: 'test-key', fetcher: async () => { throw new Error('secret network details'); } }), { status: 502, message: 'Image upload is unavailable. Please try again.' });
  await assert.rejects(uploadToImgBB('image', { key: '', fetcher: async () => { assert.fail('must not contact provider'); } }), { status: 503 });
});
