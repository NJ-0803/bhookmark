import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { JSDOM } from "jsdom";
import * as React from "react";

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' });
for (const name of ['window', 'document', 'HTMLElement', 'HTMLDialogElement', 'Node', 'MutationObserver']) Object.defineProperty(globalThis, name, { value: dom.window[name], configurable: true });
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
Object.defineProperty(globalThis, 'React', { value: React, configurable: true });
globalThis.getComputedStyle = dom.window.getComputedStyle;
dom.window.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
dom.window.HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
const { render, screen, fireEvent, waitFor, cleanup } = await import('@testing-library/react');
const { default: BookmarkForm } = await import('../src/components/BookmarkForm.tsx');
const { default: Saved } = await import('../src/screens/Saved.tsx');
const { default: RestaurantPhoto } = await import('../src/components/RestaurantPhoto.tsx');
afterEach(cleanup);
const restaurant = { id: 'osm:branch-a', name: 'Restaurant', address: 'Indiranagar, Bengaluru', source: 'osm' as const, photos: [], mapsUrl: '' };

test('save form submits an unrated wishlist item without silently assigning a score', async () => {
  let saved: any; let closed = false;
  render(React.createElement(BookmarkForm, { restaurant, onSave: async (input) => { saved = input; }, onClose: () => { closed = true; } }));
  fireEvent.change(screen.getByLabelText('Food item'), { target: { value: 'Mushroom pizza' } });
  fireEvent.change(screen.getByLabelText(/Notes/), { target: { value: 'Try next week' } });
  fireEvent.submit(screen.getByRole('button', { name: 'Save food item' }).closest('form')!);
  await waitFor(() => assert.ok(closed));
  assert.equal(saved.rating, null); assert.equal(saved.tried, false); assert.equal(saved.restaurantId, restaurant.id); assert.equal(saved.note, 'Try next week');
});

test('manual rating is an explicit optional choice available only after tried', async () => {
  let saved: any;
  render(React.createElement(BookmarkForm, { restaurant, onSave: async (input) => { saved = input; }, onClose: () => {} }));
  fireEvent.change(screen.getByLabelText('Food item'), { target: { value: 'Dosa' } });
  assert.equal(screen.queryByLabelText('Your rating out of 10'), null);
  fireEvent.click(screen.getByLabelText("I've tried this dish"));
  assert.equal((screen.getByLabelText('Your rating out of 10') as HTMLSelectElement).value, '');
  fireEvent.change(screen.getByLabelText('Your rating out of 10'), { target: { value: '8.5' } });
  fireEvent.submit(screen.getByRole('button', { name: 'Save food item' }).closest('form')!);
  await waitFor(() => assert.equal(saved?.rating, 8.5)); assert.equal(saved.tried, true);
});

test('failed saves retain the entered notes and display a retryable error', async () => {
  render(React.createElement(BookmarkForm, { restaurant, onSave: async () => { throw new Error('Connection unavailable'); }, onClose: () => assert.fail('must remain open') }));
  fireEvent.change(screen.getByLabelText('Food item'), { target: { value: 'Coffee' } });
  fireEvent.submit(screen.getByRole('button', { name: 'Save food item' }).closest('form')!);
  await screen.findByRole('alert'); assert.equal(screen.getByRole('alert').textContent, 'Connection unavailable');
  assert.equal((screen.getByLabelText('Food item') as HTMLInputElement).value, 'Coffee');
});

test('saved food groups distinct branches, supports notes search and shows manual zero honestly', () => {
  const base = { id: 'one', restaurantId: 'osm:one', restaurantName: 'Same chain', address: 'Indiranagar', name: 'Dosa', note: 'Crispy', referenceUrl: '', tried: true, rating: 0, savedAt: 1 };
  render(React.createElement(Saved, { bookmarks: [base, { ...base, id: 'two', restaurantId: 'osm:two', address: 'Whitefield', name: 'Coffee', note: 'Weekend', tried: false, rating: null }], loading: false, error: null, onRetry: () => {}, onEdit: () => {}, onRemove: async () => {}, onAdd: () => {} }));
  assert.equal(screen.getAllByRole('heading', { name: 'Same chain' }).length, 2);
  assert.ok(screen.getByText('Your rating: 0.0 / 10'));
  fireEvent.click(screen.getByRole('button', { name: 'Want to try', exact: true }));
  assert.equal(screen.queryByRole('heading', { name: 'Dosa' }), null); assert.ok(screen.getByRole('heading', { name: 'Coffee' }));
  fireEvent.change(screen.getByLabelText('Search saved dishes and notes'), { target: { value: 'weekend' } }); assert.ok(screen.getByRole('heading', { name: 'Coffee' }));
});

test('failed restaurant photos collapse without leaving an empty image box', () => {
  render(React.createElement(RestaurantPhoto, { restaurant: { ...restaurant, photos: [{ url: 'https://example.com/photo.jpg', sourceUrl: 'https://maps.google.com', authors: [{ name: 'Author', url: 'https://maps.google.com/author' }] }] } }));
  assert.ok(screen.getByRole('link', { name: 'Photo: Author' }));
  fireEvent.error(screen.getByRole('img'));
  assert.equal(screen.queryByRole('img'), null); assert.equal(document.querySelector('figure'), null);
});


test('Commons photos show their actual provider, author, date and license', () => {
  render(React.createElement(RestaurantPhoto, { restaurant: { ...restaurant, photos: [{ url: '/restaurant-photos/mtr-lalbagh.jpg', sourceUrl: 'https://commons.wikimedia.org/wiki/File:Example.jpg', provider: 'Wikimedia Commons', year: 2021, authors: [{ name: 'Gpkp', url: 'https://commons.wikimedia.org/wiki/User:Gpkp' }], license: { name: 'CC BY-SA 4.0', url: 'https://creativecommons.org/licenses/by-sa/4.0/' } }] } }));
  assert.ok(screen.getByRole('link', { name: 'Wikimedia Commons · 2021' }));
  assert.ok(screen.getByRole('link', { name: 'CC BY-SA 4.0' }));
  assert.equal(screen.queryByRole('link', { name: /Google Maps/ }), null);
});
