import { QuickLog } from "../QuickLog";

export const dynamic = "force-dynamic";

export default function LogPage() {
  return (
    <div className="wrap">
      <div className="page-head">
        <div>
          <h1>Quick log</h1>
          <p>
            WhatsApp, iMessage or a call while you are on the train.
            If the phone is offline the log is not saved — better a
            known miss than a touch that never reached the book. Nothing sends.
          </p>
        </div>
      </div>
      <div className="card" style={{ padding: 16 }}>
        <QuickLog />
      </div>
    </div>
  );
}
