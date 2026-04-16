/**
 * 固定容量泛型环形缓冲区
 * 用于存储最近 N 条记录，满时自动覆盖最旧元素。
 */
export class RingBuffer<T> {
  private buffer: (T | undefined)[];
  private head: number = 0;
  private count: number = 0;

  constructor(private readonly capacity: number) {
    if (capacity < 1 || !Number.isInteger(capacity)) {
      throw new RangeError("RingBuffer capacity must be a positive integer");
    }
    this.buffer = new Array(capacity);
  }

  /** Add item, overwrite oldest when full */
  push(item: T): void {
    const writeIndex = (this.head + this.count) % this.capacity;
    if (this.count < this.capacity) {
      this.buffer[writeIndex] = item;
      this.count++;
    } else {
      // Buffer is full — overwrite oldest (head) and advance head
      this.buffer[this.head] = item;
      this.head = (this.head + 1) % this.capacity;
    }
  }

  /** Return items in insertion order (oldest first) */
  toArray(): T[] {
    const result: T[] = [];
    for (let i = 0; i < this.count; i++) {
      result.push(this.buffer[(this.head + i) % this.capacity] as T);
    }
    return result;
  }

  /** Current number of items (not capacity) */
  get length(): number {
    return this.count;
  }

  /** Serialize to JSON-compatible format */
  toJSON(): { capacity: number; items: T[] } {
    return { capacity: this.capacity, items: this.toArray() };
  }

  /** Restore from JSON */
  static fromJSON<T>(data: { capacity: number; items: T[] }): RingBuffer<T> {
    const rb = new RingBuffer<T>(data.capacity);
    for (const item of data.items) {
      rb.push(item);
    }
    return rb;
  }
}
