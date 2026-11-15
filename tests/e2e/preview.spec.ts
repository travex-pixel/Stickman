import { expect, test } from "@playwright/test";

// Link previews (WhatsApp, Messenger, iMessage): a crawler fetches the page once, without running
// scripts, and reads the title, description and image from the HTML's head. So the tags must be
// in the first response, the addresses absolute, and the image a real JPEG of the right shape.
test("the page carries a link preview a messaging app can read", async ({ request }) => {
  const res = await request.get("/", { headers: { "user-agent": "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)" } });
  expect(res.status()).toBe(200);
  const html = await res.text();
  const head = html.slice(0, html.indexOf("</head>"));
  expect(head.length, "the head is in the first response").toBeGreaterThan(0);
  const meta = (key: string): string | null => {
    const m = head.match(new RegExp(`<meta[^>]*(?:property|name)="${key}"[^>]*content="([^"]*)"`)) ?? head.match(new RegExp(`<meta[^>]*content="([^"]*)"[^>]*(?:property|name)="${key}"`));
    return m ? m[1]!.replace(/&amp;/g, "&") : null;
  };
  expect(meta("og:title")).toBe("ASCEND");
  expect(meta("og:description")).toContain("dark-fantasy action RPG");
  expect(meta("og:type")).toBe("website");
  expect(meta("og:site_name")).toBe("ASCEND");
  expect(meta("og:url"), "the page's own address, absolute").toMatch(/^https:\/\/[^/]+\/?$/);
  const image = meta("og:image");
  expect(image, "an absolute https address for the image").toMatch(/^https:\/\/[^/]+\/og\/ascend\.jpg$/);
  expect(meta("og:image:width")).toBe("1200");
  expect(meta("og:image:height")).toBe("630");
  expect(meta("og:image:type")).toBe("image/jpeg");
  expect(meta("og:image:alt")).toBeTruthy();
  expect(meta("twitter:card")).toBe("summary_large_image");
  expect(meta("twitter:image")).toBe(image);
  expect(meta("description")).toBe(meta("og:description"));

  // The image itself, from this server: a JPEG, 1200x630, light enough for WhatsApp (under 300KB).
  const img = await request.get(new URL(image!).pathname);
  expect(img.status()).toBe(200);
  expect(img.headers()["content-type"]).toContain("image/jpeg");
  const body = await img.body();
  expect(body.length).toBeGreaterThan(20_000);
  expect(body.length).toBeLessThan(300_000);
  // JPEG: starts FF D8; the frame header (SOF0 or SOF2) carries height then width.
  expect(body[0]).toBe(0xff);
  expect(body[1]).toBe(0xd8);
  let size: { w: number; h: number } | null = null;
  for (let i = 2; i + 9 < body.length; ) {
    if (body[i] !== 0xff) break;
    const marker = body[i + 1]!;
    const len = body.readUInt16BE(i + 2);
    if (marker === 0xc0 || marker === 0xc2) {
      size = { h: body.readUInt16BE(i + 5), w: body.readUInt16BE(i + 7) };
      break;
    }
    i += 2 + len;
  }
  expect(size).toEqual({ w: 1200, h: 630 });

  // And the touch icon iMessage and home screens use.
  const icon = await request.get("/apple-touch-icon.png");
  expect(icon.status()).toBe(200);
  expect(icon.headers()["content-type"]).toContain("image/png");
});
