import test from 'node:test';
import assert from 'node:assert/strict';
import { profileNameError } from '../src/lib/profile-name.js';

test('profile rejects phone numbers entered with the name', () => {
  assert.ok(profileNameError('Егор Копылов +79777717819'));
  assert.ok(profileNameError('+7 (999) 123-45-67'));
});
test('profile accepts names with optional patronymic and hyphens', () => {
  assert.equal(profileNameError('Иванова Анна Сергеевна'), null);
  assert.equal(profileNameError('Ева-София Мелихова'), null);
  assert.ok(profileNameError('Анна'));
});
