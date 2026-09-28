import { test, expect } from "vitest"
import { parseKtp, scheduleFromKtp, schoolYearStart } from "../ktp"

test("таблица с табуляцией: номер, тема, часы, дата", () => {
  const text = [
    "№\tТема урока\tКол-во часов\tДата",
    "1\tВводный урок. Книга как источник знаний\t1\t02.09",
    "2\tУстное народное творчество\t1\t04.09",
    "3\tБылины. «Илья Муромец»\t2\t09.09-11.09",
  ].join("\n")
  const r = parseKtp(text, { year: 2026 })
  expect(r.lessons).toEqual([
    { num: 1, title: "Вводный урок. Книга как источник знаний", date: "2026-09-02", hours: 1 },
    { num: 2, title: "Устное народное творчество", date: "2026-09-04", hours: 1 },
    { num: 3, title: "Былины. «Илья Муромец»", date: "2026-09-09", hours: 2 },
  ])
  expect(r.skipped).toBe(1)
})

test("простой список «12. Тема» и перенос темы на следующую строку", () => {
  const r = parseKtp("Примечание\n1. Пушкин. Лирика\n   продолжение темы\n2) Лермонтов\n№3 Гоголь")
  expect(r.lessons.map((l) => [l.num, l.title])).toEqual([[1, "Пушкин. Лирика продолжение темы"], [2, "Лермонтов"], [3, "Гоголь"]])
  expect(r.skipped).toBe(1)
})

test("дубли номеров схлопываются, порядок по номеру", () => {
  const r = parseKtp("2 | Вторая | 1\n1 | Первая | 1\n2 | Ещё вторая | 1")
  expect(r.lessons.map((l) => l.num)).toEqual([1, 2])
  expect(r.lessons[1].title).toBe("Вторая")
})

test("график из дат: старт, уроков в неделю, первая неделя", () => {
  // 2 сентября 2026 — среда: первая неделя 2 урока, дальше по 3.
  const lessons = [
    ["2026-09-02"], ["2026-09-04"],
    ["2026-09-07"], ["2026-09-09"], ["2026-09-11"],
    ["2026-09-14"], ["2026-09-16"], ["2026-09-18"],
  ].map(([date], i) => ({ num: i + 1, title: "t", date }))
  expect(scheduleFromKtp(lessons)).toEqual({ start: "2026-09-02", perWeek: 3, firstWeekLessons: 2 })
  expect(scheduleFromKtp([{ num: 1, title: "t" }])).toBeNull()
})

test("дата без года — по учебному году: сентябрь–декабрь — год начала, январь — следующий", () => {
  const r = parseKtp("1\tВводный урок\t02.09\n40\tПовторение\t15.01\n41\tИтоговый урок\t20.05.2027", { year: 2026 })
  expect(r.lessons.map((l) => l.date)).toEqual(["2026-09-02", "2027-01-15", "2027-05-20"])
  // Учебный год начинается с июля: в сентябре 2026 — 2026/27, в марте 2027 — тоже.
  expect(schoolYearStart(new Date(2026, 8, 28))).toBe(2026)
  expect(schoolYearStart(new Date(2027, 2, 1))).toBe(2026)
  expect(schoolYearStart(new Date(2027, 6, 1))).toBe(2027)
})

test("дата — только из ячейки, которая целиком дата; числа в теме не трогаются", () => {
  const r = parseKtp("1\tПараграф 1.2 Натуральные числа\t1\n2\tПараграф 1.3 Сложение\t1\t2.9\n3 | Деление | 02/09", { year: 2026 })
  expect(r.lessons).toEqual([
    { num: 1, title: "Параграф 1.2 Натуральные числа", hours: 1 },
    { num: 2, title: "Параграф 1.3 Сложение", hours: 1, date: "2026-09-02" },
    { num: 3, title: "Деление", date: "2026-09-02" },
  ])
})
