import { describe, expect, it } from "vitest";
import { BaseACL } from "../base-acl.js";

interface Foo {
  readonly name: string;
}
interface FooExt {
  readonly n: string;
}

class FooACL extends BaseACL<Foo, FooExt> {
  public toDomainCalls = 0;
  protected override mapToDomain(external: FooExt): Foo {
    this.toDomainCalls += 1;
    return { name: external.n };
  }
  protected override mapFromDomain(domain: Foo): FooExt {
    return { n: domain.name };
  }
}

describe("BaseACL", () => {
  it("toDomain delegates to mapToDomain", () => {
    const acl = new FooACL();
    expect(acl.toDomain({ n: "hello" })).toEqual({ name: "hello" });
  });

  it("fromDomain delegates to mapFromDomain", () => {
    const acl = new FooACL();
    expect(acl.fromDomain({ name: "hello" })).toEqual({ n: "hello" });
  });

  it("round-trips identity", () => {
    const acl = new FooACL();
    const ext = { n: "x" };
    expect(acl.fromDomain(acl.toDomain(ext))).toEqual(ext);
  });

  it("without cache, every toDomain call hits mapToDomain", () => {
    const acl = new FooACL();
    acl.toDomain({ n: "a" });
    acl.toDomain({ n: "a" });
    expect(acl.toDomainCalls).toBe(2);
  });

  it("with cache, repeated calls hit cache", () => {
    const acl = new FooACL({ cacheSize: 10 });
    acl.toDomain({ n: "a" });
    acl.toDomain({ n: "a" });
    expect(acl.toDomainCalls).toBe(1);
    expect(acl.cacheEntries()).toBe(1);
  });

  it("cache respects size + evicts oldest", () => {
    const acl = new FooACL({ cacheSize: 2 });
    acl.toDomain({ n: "a" });
    acl.toDomain({ n: "b" });
    acl.toDomain({ n: "c" });
    expect(acl.cacheEntries()).toBe(2);
  });

  it("cache treats equal-canonical externals as the same key", () => {
    interface Multi {
      readonly a: number;
      readonly b: number;
    }
    class MultiACL extends BaseACL<Multi, Multi> {
      public calls = 0;
      protected override mapToDomain(external: Multi): Multi {
        this.calls += 1;
        return external;
      }
      protected override mapFromDomain(domain: Multi): Multi {
        return domain;
      }
    }
    const acl = new MultiACL({ cacheSize: 10 });
    acl.toDomain({ a: 1, b: 2 });
    acl.toDomain({ b: 2, a: 1 });
    expect(acl.calls).toBe(1);
  });
});
