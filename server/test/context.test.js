import assert from 'node:assert/strict';
import test from 'node:test';
import { combineRules, selectPool, ruleMatches, inTimeRange, passesFilters } from '../src/context.js';

const song = (id, genre, energy, mood, themes = []) => ({ id, genre, energy, mood, themes });
const catalog = [
  song(1, 'pop', 'medium', 'alegre'),
  song(2, 'pop', 'high', 'alegre'),
  song(3, 'instrumental', 'low', 'tranquilo'),
  song(4, 'instrumental', 'low', 'fresco'),
  song(5, 'rock', 'high', 'fresco'),
  song(6, 'regional', 'high', 'alegre', ['navidad']),
  song(7, 'pop', 'medium', 'navideño', ['navidad']),
];
const morning = { name: 'Mañana', priority: 1, condition: { time_from: '07:00', time_to: '12:00' }, filters: { energy: ['medium', 'low'] } };
const hot = { name: 'Calor', priority: 2, condition: { temp_min: 30 }, filters: { moods: ['fresco', 'tranquilo'] } };
const exams = { name: 'Exámenes', priority: 10, condition: { event_type: 'exam', exclusive: true }, filters: { genres: ['instrumental'], energy: ['low'] } };
const xmas = { name: 'Navidad', priority: 5, condition: { event_type: 'holiday' }, filters: { themes: ['navidad'] } };

test('inTimeRange admite rangos que cruzan la medianoche', () => {
  assert.equal(inTimeRange('23:30', '22:00', '02:00'), true);
  assert.equal(inTimeRange('03:00', '22:00', '02:00'), false);
  assert.equal(inTimeRange('09:00', '07:00', '12:00'), true);
});

test('ruleMatches evalúa hora, temperatura y eventos', () => {
  const ctx = { hhmm: '09:15', temp: 32, eventTypes: ['exam'] };
  assert.equal(ruleMatches(morning.condition, ctx), true);
  assert.equal(ruleMatches(hot.condition, ctx), true);
  assert.equal(ruleMatches(exams.condition, ctx), true);
  assert.equal(ruleMatches(xmas.condition, ctx), false);
  assert.equal(ruleMatches(hot.condition, { ...ctx, temp: null }), false);
});

test('las reglas se combinan: la temperatura ajusta el ambiente dentro de la franja horaria', () => {
  const { filters, applied } = combineRules([hot, morning]);
  assert.deepEqual(filters, { moods: ['fresco', 'tranquilo'], energy: ['medium', 'low'] });
  assert.deepEqual(applied.map(r => r.name), ['Calor', 'Mañana']);
  const pool = catalog.filter(s => passesFilters(s, filters)).map(s => s.id);
  assert.deepEqual(pool, [3, 4]);
});

test('una regla exclusiva de exámenes tiene prioridad sobre horario y temperatura', () => {
  const { filters, applied } = combineRules([exams, hot, morning]);
  assert.deepEqual(applied.map(r => r.name), ['Exámenes']);
  assert.deepEqual(filters, { genres: ['instrumental'], energy: ['low'] });
});

test('una festividad activa la selección temática', () => {
  const { pool, applied } = selectPool(catalog, [xmas]);
  assert.deepEqual(pool.map(s => s.id), [6, 7]);
  assert.deepEqual(applied.map(r => r.name), ['Navidad']);
});

test('si las reglas dejan menos de dos opciones se relajan las de menor prioridad', () => {
  // Navidad + Mañana solo deja la canción 7; se descarta Mañana y quedan 6 y 7.
  const out = selectPool(catalog, [xmas, morning]);
  assert.deepEqual(out.pool.map(s => s.id), [6, 7]);
  assert.equal(out.relaxed, true);
  assert.deepEqual(out.applied.map(r => r.name), ['Navidad']);
});

test('si ni la regla principal deja dos opciones, no hay candidatas (se usará el respaldo)', () => {
  const rare = { name: 'Rara', priority: 1, condition: {}, filters: { genres: ['jazz'] } };
  assert.equal(selectPool(catalog, [rare]).pool.length, 0);
});

test('sin reglas que coincidan se usa todo el catálogo', () => {
  assert.equal(selectPool(catalog, []).pool.length, catalog.length);
});
