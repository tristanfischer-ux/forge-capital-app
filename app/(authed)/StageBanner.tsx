export function StageBanner({ number, title }: { number: number; title: string }) {
  return (
    <div className="stage-banner">
      <span className="stage-num">{number}.</span>
      {title}
    </div>
  );
}
