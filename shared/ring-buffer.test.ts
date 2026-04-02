import { describe, expect, it } from 'vitest';
import { RingBuffer } from './ring-buffer.js';

describe('RingBuffer', () => {
  describe('constructor', () => {
    it('throws on non-positive capacity', () => {
      expect(() => new RingBuffer(0)).toThrow(RangeError);
      expect(() => new RingBuffer(-1)).toThrow(RangeError);
      expect(() => new RingBuffer(1.5)).toThrow(RangeError);
    });

    it('creates empty buffer with given capacity', () => {
      const rb = new RingBuffer<number>(5);
      expect(rb.length).toBe(0);
      expect(rb.toArray()).toEqual([]);
    });
  });

  describe('push and toArray', () => {
    it('adds items in order', () => {
      const rb = new RingBuffer<number>(3);
      rb.push(1);
      rb.push(2);
      expect(rb.toArray()).toEqual([1, 2]);
      expect(rb.length).toBe(2);
    });

    it('overwrites oldest when full', () => {
      const rb = new RingBuffer<number>(3);
      rb.push(1);
      rb.push(2);
      rb.push(3);
      rb.push(4); // overwrites 1
      expect(rb.toArray()).toEqual([2, 3, 4]);
      expect(rb.length).toBe(3);
    });

    it('handles capacity of 1', () => {
      const rb = new RingBuffer<string>(1);
      rb.push('a');
      expect(rb.toArray()).toEqual(['a']);
      rb.push('b');
      expect(rb.toArray()).toEqual(['b']);
      expect(rb.length).toBe(1);
    });

    it('handles multiple wraps around', () => {
      const rb = new RingBuffer<number>(3);
      for (let i = 0; i < 10; i++) rb.push(i);
      expect(rb.toArray()).toEqual([7, 8, 9]);
    });
  });

  describe('toJSON / fromJSON round-trip', () => {
    it('round-trips an empty buffer', () => {
      const rb = new RingBuffer<number>(5);
      const json = rb.toJSON();
      const restored = RingBuffer.fromJSON<number>(json);
      expect(restored.length).toBe(0);
      expect(restored.toArray()).toEqual([]);
      expect(restored.toJSON().capacity).toBe(5);
    });

    it('round-trips a partially filled buffer', () => {
      const rb = new RingBuffer<number>(5);
      rb.push(10);
      rb.push(20);
      const restored = RingBuffer.fromJSON<number>(rb.toJSON());
      expect(restored.toArray()).toEqual([10, 20]);
      expect(restored.length).toBe(2);
    });

    it('round-trips a full buffer that has wrapped', () => {
      const rb = new RingBuffer<number>(3);
      for (let i = 1; i <= 5; i++) rb.push(i);
      const restored = RingBuffer.fromJSON<number>(rb.toJSON());
      expect(restored.toArray()).toEqual([3, 4, 5]);
      expect(restored.length).toBe(3);
    });

    it('round-trips through JSON.stringify/parse', () => {
      const rb = new RingBuffer<{ id: string }>(2);
      rb.push({ id: 'a' });
      rb.push({ id: 'b' });
      rb.push({ id: 'c' });
      const raw = JSON.parse(JSON.stringify(rb.toJSON()));
      const restored = RingBuffer.fromJSON<{ id: string }>(raw);
      expect(restored.toArray()).toEqual([{ id: 'b' }, { id: 'c' }]);
    });
  });

  describe('continued use after fromJSON', () => {
    it('can push new items after restoring', () => {
      const rb = new RingBuffer<number>(3);
      rb.push(1);
      rb.push(2);
      const restored = RingBuffer.fromJSON<number>(rb.toJSON());
      restored.push(3);
      restored.push(4); // overwrites 1
      expect(restored.toArray()).toEqual([2, 3, 4]);
    });
  });
});
