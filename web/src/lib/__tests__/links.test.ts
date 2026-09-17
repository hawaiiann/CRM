import { test, expect } from "vitest"
import { splitLinks, extractLinks, linkLabel } from "../links"

test("ссылки выделяются из текста, знаки препинания в конце не входят", () => {
  const parts = splitLinks("6кл лит https://drive.google.com/drive/folders/1UiJAY, и ещё http://example.org/x.")
  expect(parts).toEqual([
    { kind: "text", value: "6кл лит " },
    { kind: "link", value: "https://drive.google.com/drive/folders/1UiJAY" },
    { kind: "text", value: ", и ещё " },
    { kind: "link", value: "http://example.org/x" },
    { kind: "text", value: "." },
  ])
  expect(extractLinks("без ссылок")).toEqual([])
  expect(splitLinks("")).toEqual([])
})

test("подпись ссылки — по хосту", () => {
  expect(linkLabel("https://drive.google.com/drive/folders/1")).toBe("Google Диск")
  expect(linkLabel("https://disk.yandex.ru/d/abc")).toBe("Яндекс Диск")
  expect(linkLabel("https://www.example.org/path")).toBe("example.org")
  expect(linkLabel("not a url")).toBe("not a url")
})
