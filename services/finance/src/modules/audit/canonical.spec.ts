import { canonical, chainHash, GENESIS } from "./canonical";
describe("Audit canonical JSON", () => {
  it("sắp xếp key đệ quy, giữ thứ tự array, phân biệt null/chuỗi và escape", () => {
    expect(canonical({ z: [{ b: 2, a: 1 }], a: null, ignored: undefined })).toBe(
      '{"a":null,"z":[{"a":1,"b":2}]}',
    );
    expect(canonical({ text: 'a"b\n' })).toBe('{"text":"a\\"b\\n"}');
    expect(chainHash(GENESIS, { b: 2, a: 1 })).toBe(chainHash(GENESIS, { a: 1, b: 2 }));
    expect(chainHash(GENESIS, { a: 1 })).not.toBe(chainHash(GENESIS, { a: "1" }));
  });
});
