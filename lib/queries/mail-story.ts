import {
  formatMailDate,
  isYouAddress,
  type MeetingCorrespondence,
} from "@/lib/queries/meeting-brief";

export function mailStory(
  mail: MeetingCorrespondence[],
  searched: string[],
): string {
  if (mail.length === 0) {
    if (searched.length > 0) {
      return `Gmail and the book returned 0 for: ${searched.join(", ")}.`;
    }
    return "No attendee email to search, so there is no correspondence to show.";
  }
  const inbound = mail.filter((m) => !isYouAddress(m.from));
  const outbound = mail.filter((m) => isYouAddress(m.from));
  const lastIn = inbound[0];
  const lastOut = outbound[0];
  const bits = [
    `${mail.length} message${mail.length === 1 ? "" : "s"} on file, newest first.`,
  ];
  if (lastOut) {
    bits.push(
      `You last wrote ${formatMailDate(lastOut.date)}${
        lastOut.subject ? ` (“${lastOut.subject}”)` : ""
      }.`,
    );
  }
  if (lastIn) {
    bits.push(
      `They last wrote ${formatMailDate(lastIn.date)}${
        lastIn.subject ? ` (“${lastIn.subject}”)` : ""
      }.`,
    );
  } else if (lastOut) {
    bits.push("No reply on file after that.");
  }
  return bits.join(" ");
}
