import { describe, expect, test } from "bun:test";

import { browserOf } from "./water-diagnostic";

describe("browserOf", () => {
  test("names the browser and its major version", () => {
    expect(browserOf("Mozilla/5.0 (X11; Linux x86_64; rv:150.0) Gecko/20100101 Firefox/150.0")).toBe("Firefox 150");
    expect(browserOf("Mozilla/5.0 (Macintosh) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36")).toBe("Chrome 152");
    expect(browserOf("Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36 Edg/152.0.0.0")).toBe("Edge 152");
    expect(browserOf("Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.1 Safari/605.1.15")).toBe("Safari 19");
    expect(browserOf("curl/8")).toBe("Unknown");
  });
});
