// Jest类型声明文件
declare global {
  function describe(name: string, fn: () => void): void;
  function test(name: string, fn: (done?: any) => void | Promise<void>, timeout?: number): void;
  function it(name: string, fn: (done?: any) => void | Promise<void>, timeout?: number): void;
  function beforeEach(fn: () => void | Promise<void>): void;
  function afterEach(fn: () => void | Promise<void>): void;
  function beforeAll(fn: () => void | Promise<void>): void;
  function afterAll(fn: () => void | Promise<void>): void;

  namespace jest {
    interface Matchers<R> {
      toBe(expected: any): R;
      toEqual(expected: any): R;
      toBeTruthy(): R;
      toBeFalsy(): R;
      toBeUndefined(): R;
      toBeDefined(): R;
      toBeNull(): R;
      toBeNaN(): R;
      toBeGreaterThan(expected: number): R;
      toBeGreaterThanOrEqual(expected: number): R;
      toBeLessThan(expected: number): R;
      toBeLessThanOrEqual(expected: number): R;
      toContain(expected: any): R;
      toMatch(expected: string | RegExp): R;
      toThrow(expected?: string | RegExp | Error): R;
      toHaveLength(expected: number): R;
      toHaveProperty(keyPath: string, value?: any): R;
      not: Matchers<R>;
    }

    interface Expect {
      <T = any>(actual: T): Matchers<void> & {
        not: Matchers<void>;
        resolves: Matchers<Promise<void>> & {
          not: Matchers<Promise<void>>;
        };
        rejects: Matchers<Promise<void>>;
      };
    }
  }

  const expect: jest.Expect;
}

export {};