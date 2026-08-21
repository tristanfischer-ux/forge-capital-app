import { NextResponse } from "next/server";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { requireTristan } from "@/lib/capital/assert-user";
import { buildCanonicalWorkbook } from "@/lib/capital/export-from-db";
import { markFeed } from "@/lib/capital/sync-mail";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

function runPython(): Promise<{ code: number; stdout: string; stderr: string }> {
  const script = path.join(process.cwd(), "scripts", "capital-export.py");
  return new Promise((resolve) => {
    const child = spawn("python3", [script], { cwd: process.cwd() });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => {
      stdout += String(d);
    });
    child.stderr.on("data", (d) => {
      stderr += String(d);
    });
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
    child.on("error", (err) => resolve({ code: 1, stdout, stderr: err.message }));
  });
}

export async function GET() {
  try {
    await requireTristan();
  } catch {
    return NextResponse.json({ error: "not signed in" }, { status: 401 });
  }
  const stamp = new Date().toISOString().slice(2, 10).replace(/-/g, "");
  const name = `${stamp} Master Investor Tracker TF (CANONICAL).xlsx`;
  const result = await runPython();
  if (result.code === 0) {
    try {
      const parsed = JSON.parse(result.stdout.trim().split("\n").pop() ?? "{}") as { out?: string };
      if (parsed.out) {
        const buf = await readFile(parsed.out);
        await markFeed("export");
        return new NextResponse(new Uint8Array(buf), {
          headers: {
            "Content-Type":
              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "Content-Disposition": `attachment; filename="${path.basename(parsed.out)}"`,
          },
        });
      }
    } catch {
      /* fall through to in-process builder */
    }
  }
  const buf = await buildCanonicalWorkbook();
  await markFeed("export");
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${name}"`,
    },
  });
}
