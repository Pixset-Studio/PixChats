import test from 'node:test';
import assert from 'node:assert/strict';
import { generateValidQrMatrix } from './qrCodeGenerator';

test('generateValidQrMatrix creates valid Version 1 (21x21) matrix for short string', () => {
  const matrix = generateValidQrMatrix('https://pixchats.app');
  // 20 bytes -> fits in Version 2 (25x25) since Version 1 L holds up to 17 bytes
  assert.equal(matrix.length, 25);
  assert.equal(matrix[0].length, 25);

  // Verify top-left 7x7 finder pattern outer ring is dark
  for (let i = 0; i < 7; i++) {
    assert.equal(matrix[0][i], true);
    assert.equal(matrix[6][i], true);
    assert.equal(matrix[i][0], true);
    assert.equal(matrix[i][6], true);
  }
  // Verify finder pattern inner 3x3 center is dark
  for (let r = 2; r <= 4; r++) {
    for (let c = 2; c <= 4; c++) {
      assert.equal(matrix[r][c], true);
    }
  }
  // Verify separator around top-left finder pattern is white (false)
  for (let i = 0; i < 8; i++) {
    assert.equal(matrix[7][i], false);
    assert.equal(matrix[i][7], false);
  }
});

test('generateValidQrMatrix scales version automatically for longer PixChats QR auth URLs', () => {
  const url = 'https://pixchats.vercel.app/login?qr_session=abcd1234efgh5678&code=948271';
  const matrix = generateValidQrMatrix(url);
  assert.ok(matrix.length >= 29 && matrix.length <= 57);
  assert.equal(matrix.length % 4, 1); // N = 4*V + 17 -> N % 4 === 1
  // Dark module at (size - 8, 8) is always true per ISO/IEC 18004
  assert.equal(matrix[matrix.length - 8][8], true);
});
