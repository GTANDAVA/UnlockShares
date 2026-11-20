import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lireYahoo, lireHyperliquid, seanceOuverte, versDollars, versUnites } from './sources.mjs';

const reponse = (corps, ok = true, status = 200) => async () => ({ ok, status, json: async () => corps });

test('conversion exacte en 7 décimales', () => {
  assert.equal(versUnites('187.405'), 1_874_050_000n);
  assert.equal(versUnites('200'), 2_000_000_000n);
  assert.equal(versUnites('1.123456789'), 11_234_567n); // tronqué, pas arrondi
  assert.equal(versDollars(1_874_050_000n), '187.4050');
  assert.throws(() => versUnites('-3'));
  assert.throws(() => versUnites('abc'));
});

test('Hyperliquid : lit le prix oracle, pas le prix d\'échange', async () => {
  const corps = [
    { universe: [{ name: 'xyz:TSLA' }, { name: 'xyz:AAPL' }] },
    [{ oraclePx: '410.1', markPx: '411' }, { oraclePx: '187.42', markPx: '190.00', midPx: '189.9' }],
  ];
  const lu = await lireHyperliquid(reponse(corps));
  assert.equal(lu.prix, 1_874_200_000n);
});

test('Hyperliquid : marché absent ou prix absurde refusé', async () => {
  await assert.rejects(lireHyperliquid(reponse([{ universe: [{ name: 'xyz:TSLA' }] }, [{ oraclePx: '1' }]])), /introuvable/);
  await assert.rejects(lireHyperliquid(reponse([{ universe: [{ name: 'xyz:AAPL' }] }, [{ oraclePx: '0.5' }]])), /hors bornes/);
  await assert.rejects(lireHyperliquid(reponse({}, false, 500)), /HTTP 500/);
});

const yahoo = (prix, t, extra = {}) => ({ chart: { result: [{ meta: { symbol: 'AAPL', currency: 'USD', regularMarketPrice: prix, regularMarketTime: t, ...extra } }] } });

test('Yahoo : cours récent accepté, vieux cours ou mauvais titre refusé', async () => {
  const t = 1_763_200_000;
  const maintenant = new Date((t + 60) * 1000);
  const lu = await lireYahoo(reponse(yahoo(187.4, t)), maintenant);
  assert.equal(lu.prix, 1_874_000_000n);
  await assert.rejects(lireYahoo(reponse(yahoo(187.4, t)), new Date((t + 3600) * 1000)), /trop vieux/);
  await assert.rejects(lireYahoo(reponse(yahoo(0, t)), maintenant), /vide/);
  await assert.rejects(lireYahoo(reponse(yahoo(187.4, t, { symbol: 'MSFT' })), maintenant), /mauvais titre/);
  await assert.rejects(lireYahoo(reponse(yahoo(187.4, t, { currency: 'EUR' })), maintenant), /devise/);
  await assert.rejects(lireYahoo(reponse({ chart: { result: null } }), maintenant), /vide/);
  await assert.rejects(lireYahoo(reponse({}, false, 429)), /HTTP 429/);
});

test('séance de New York', () => {
  assert.equal(seanceOuverte(new Date('2026-11-16T15:00:00Z')), true); // lundi 10 h à New York
  assert.equal(seanceOuverte(new Date('2026-11-16T14:29:00Z')), false); // lundi 9 h 29
  assert.equal(seanceOuverte(new Date('2026-11-16T21:00:00Z')), false); // lundi 16 h
  assert.equal(seanceOuverte(new Date('2026-11-15T16:00:00Z')), false); // dimanche
  assert.equal(seanceOuverte(new Date('2026-07-06T13:45:00Z')), true); // été (EDT) : 9 h 45
});

test('Yahoo : autre action (hub & spokes), titre vérifié et titre invalide refusé', async () => {
  const t = 1_763_200_000;
  const maintenant = new Date((t + 60) * 1000);
  const lu = await lireYahoo(reponse(yahoo(181.2, t, { symbol: 'NVDA' })), maintenant, undefined, 'NVDA');
  assert.equal(lu.prix, 1_812_000_000n);
  await assert.rejects(lireYahoo(reponse(yahoo(181.2, t)), maintenant, undefined, 'NVDA'), /mauvais titre/);
  await assert.rejects(lireYahoo(reponse(yahoo(181.2, t)), maintenant, undefined, 'nvda/../x'), /titre invalide/);
});
