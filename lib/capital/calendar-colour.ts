import { MANDATE_LABEL, type MandateCode } from "@/lib/capital/mandates";

export type CalendarProgramme = MandateCode | "personal";

export type LiveCalendarEvent = {
  id: string;
  event_at: string;
  end_at: string | null;
  day_key: string;
  title: string;
  notes: string | null;
  htmlLink: string | null;
  location: string | null;
  allDay: boolean;
  canceled: boolean;
  programmes: MandateCode[];
  colour: CalendarProgramme;
  attendee_emails: string[];
};

export function programmesForBlob(blob: string): MandateCode[] {
  const hits = new Set<MandateCode>();
  if (/space solar/i.test(blob)) hits.add("SS");
  if (/odysseus/i.test(blob)) hits.add("OD");
  if (/skysails|stephan wrage/i.test(blob)) hits.add("SK");
  if (/fishfrom|geosmin|\bmib\b|frea|atlantium/i.test(blob)) hits.add("FF");
  if (/panatere/i.test(blob)) hits.add("PA");
  if (/hooley|avealto|airship|e-band/i.test(blob)) hits.add("HO");
  if (/\bcasper\b/i.test(blob)) hits.add("CA");
  if (/\barbitrage\b/i.test(blob)) hits.add("US");
  if (/\byuri\b|yurigravity|\brpm\b|random positioning/i.test(blob)) hits.add("YU");
  return [...hits];
}

export function programmeLabel(code: CalendarProgramme): string {
  if (code === "personal") return "Other";
  if (code === "YU") return "Yuri";
  return MANDATE_LABEL[code] ?? code;
}
