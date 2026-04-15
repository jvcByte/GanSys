import { hashPassword, verifyPassword } from "@/lib/auth";

describe("auth utilities", () => {
  it("hashes and verifies passwords", () => {
    const hash = hashPassword("demo1234");
    expect(verifyPassword("demo1234", hash)).toBe(true);
    expect(verifyPassword("wrong-pass", hash)).toBe(false);
  });
});
