import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import { classificationQuery } from "../api/queries";
import type { CategoryEvaluation, ReplayResult } from "../api/types";
import { ErrorNote, Loading, errorMessage } from "../components/Loading";
import { useToast } from "../components/Toast";
import { Badge, type BadgeTone } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { cx, shortHash } from "../lib/format";

const HANDLING_TONE: Record<CategoryEvaluation["handling"], BadgeTone> = {
  scored: "green",
  escalated_conservative: "amber",
  needs_info: "gray",
};

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5">
      <dt className="text-xs text-gray-500">{label}</dt>
      <dd className="text-right text-xs font-medium text-gray-800">{children}</dd>
    </div>
  );
}

export function DerivationView({
  classificationId,
  showReplay = false,
}: {
  classificationId: string;
  showReplay?: boolean;
}) {
  const toast = useToast();
  const classification = useQuery(classificationQuery(classificationId));

  const replay = useMutation({
    mutationFn: () =>
      api.post<ReplayResult>(`/classifications/${classificationId}/replay`),
    onError: (err) => toast.push(errorMessage(err), "error"),
  });

  if (classification.isPending) return <Loading label="Loading derivation…" />;
  if (classification.isError) return <ErrorNote error={classification.error} />;

  const c = classification.data;
  const d = c.derivation;
  const binding = d?.composition?.baseTier.bindingCategory;

  return (
    <div className="space-y-6">
      {/* Final tier headline */}
      <div className="flex items-center justify-between rounded-lg border border-gray-200 bg-white px-5 py-4">
        <div>
          {c.status === "ROUTED" ? (
            <>
              <p className="text-xs font-semibold tracking-wide text-gray-500 uppercase">
                Final required tier
              </p>
              <p className="mt-0.5 text-3xl font-bold tracking-tight text-indigo-700">
                Tier {c.tier}
                {c.tierName && (
                  <span className="ml-2 text-base font-medium text-gray-500">{c.tierName}</span>
                )}
              </p>
            </>
          ) : (
            <>
              <Badge tone="amber">INCOMPLETE</Badge>
              <p className="mt-1 text-sm text-gray-600">
                The engine refused to score — required facts are missing.
              </p>
            </>
          )}
          <p className="mt-1 font-mono text-xs text-gray-400">
            engine {c.engineVersion} · derivation {shortHash(c.derivationHash)}
          </p>
        </div>
        {showReplay && (
          <div className="text-right">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => replay.mutate()}
              disabled={replay.isPending}
            >
              {replay.isPending ? "Replaying…" : "Replay"}
            </Button>
            {replay.isSuccess && (
              <div
                className={cx(
                  "mt-2 rounded-md px-3 py-2 text-left text-xs",
                  replay.data.match
                    ? "border border-green-200 bg-green-50 text-green-800"
                    : "border border-red-200 bg-red-50 text-red-800"
                )}
              >
                {replay.data.match ? (
                  <p className="font-semibold">Replay MATCHED the stored derivation.</p>
                ) : (
                  <p className="font-semibold">Replay MISMATCH — derivation drifted.</p>
                )}
                <p className="mt-1 font-mono">
                  stored {shortHash(replay.data.storedHash)} (engine{" "}
                  {replay.data.storedEngineVersion})
                  <br />
                  replayed {shortHash(replay.data.replayedHash)} (engine{" "}
                  {replay.data.engineVersion})
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {c.missingFacts && c.missingFacts.length > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3">
          <p className="text-sm font-semibold text-amber-800">Missing facts</p>
          <ul className="mt-1 space-y-0.5 text-sm text-amber-800">
            {c.missingFacts.map((m) => (
              <li key={m.category}>
                <span className="font-medium">{m.category}:</span>{" "}
                <span className="font-mono text-xs">{m.facts.join(", ")}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {d && (
        <>
          {/* Per-category evaluations */}
          <section>
            <h3 className="mb-2 text-sm font-semibold text-gray-900">Category evaluations</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              {d.categoryEvaluations.map((ev) => {
                const isBinding = ev.category === binding;
                return (
                  <dl
                    key={ev.category}
                    className={cx(
                      "rounded-lg border bg-white px-4 py-3",
                      isBinding
                        ? "border-indigo-400 ring-2 ring-indigo-100"
                        : "border-gray-200"
                    )}
                  >
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-gray-900">{ev.category}</span>
                      <span className="flex items-center gap-1.5">
                        {isBinding && <Badge tone="indigo">binding</Badge>}
                        <Badge tone={HANDLING_TONE[ev.handling]}>
                          {ev.handling.replace(/_/g, " ")}
                        </Badge>
                      </span>
                    </div>
                    {ev.impactBand !== undefined && <Row label="Impact band">{ev.impactBand}</Row>}
                    {ev.bandRuleFired !== undefined && (
                      <Row label="Band rule fired">
                        <span className="font-mono">{ev.bandRuleFired}</span>
                      </Row>
                    )}
                    {ev.likelihoodBand !== undefined && (
                      <Row label="Likelihood">{ev.likelihoodBand}</Row>
                    )}
                    {ev.matrixRating !== undefined && (
                      <Row label="Matrix rating">{ev.matrixRating}</Row>
                    )}
                    {ev.appetiteRowApplied !== undefined && (
                      <Row label="Appetite row">{ev.appetiteRowApplied.replace(/_/g, " ")}</Row>
                    )}
                    {ev.requiredTier !== undefined && (
                      <Row label="Required tier">Tier {ev.requiredTier}</Row>
                    )}
                    {ev.appetiteBreached !== undefined && (
                      <Row label="Appetite">
                        {ev.appetiteBreached ? (
                          <Badge tone="red">breached</Badge>
                        ) : (
                          <Badge tone="green">within appetite</Badge>
                        )}
                      </Row>
                    )}
                    {ev.distanceFromNextBoundary !== undefined && (
                      <Row label="Distance from next boundary">
                        {ev.distanceFromNextBoundary.bands} band(s){" "}
                        {ev.distanceFromNextBoundary.direction}
                      </Row>
                    )}
                    {ev.missingFacts !== undefined && ev.missingFacts.length > 0 && (
                      <Row label="Missing facts">
                        <span className="font-mono text-amber-700">
                          {ev.missingFacts.join(", ")}
                        </span>
                      </Row>
                    )}
                  </dl>
                );
              })}
            </div>
          </section>

          {/* Triggers — every tested trigger, fired or not */}
          {d.composition && (
            <section>
              <h3 className="mb-2 text-sm font-semibold text-gray-900">
                Escalation triggers{" "}
                <span className="font-normal text-gray-400">
                  (all tested triggers are recorded — not-fired is the audit point)
                </span>
              </h3>
              <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white">
                {d.composition.triggers.length === 0 && (
                  <li className="px-4 py-3 text-sm text-gray-400">
                    The policy defines no escalation triggers.
                  </li>
                )}
                {d.composition.triggers.map((t) => (
                  <li key={t.id} className="flex items-center justify-between px-4 py-2.5">
                    <span className="flex items-center gap-2.5">
                      <span
                        className={cx(
                          "h-2 w-2 rounded-full",
                          t.fired ? "bg-red-500" : "bg-gray-300"
                        )}
                      />
                      <span
                        className={cx(
                          "font-mono text-xs",
                          t.fired ? "font-semibold text-gray-900" : "text-gray-500"
                        )}
                      >
                        {t.id}
                      </span>
                    </span>
                    <span className="flex items-center gap-2 text-xs text-gray-500">
                      {t.minTier !== undefined && <span>min tier {t.minTier}</span>}
                      {t.tierUplift !== undefined && <span>uplift +{t.tierUplift}</span>}
                      <Badge tone={t.fired ? "red" : "gray"}>
                        {t.fired ? "fired" : "not fired"}
                      </Badge>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Composition: base tier, accumulation, agent uplift */}
          {d.composition && (
            <section className="rounded-lg border border-gray-200 bg-white px-4 py-3">
              <h3 className="mb-2 text-sm font-semibold text-gray-900">Tier composition</h3>
              <dl className="space-y-1">
                <Row label="Base tier">
                  Tier {d.composition.baseTier.tier} — bound by{" "}
                  <span className="font-semibold">{d.composition.baseTier.bindingCategory}</span>
                </Row>
                {d.composition.accumulation && (
                  <Row label={`Accumulation (count at or above ${d.composition.accumulation.countAtOrAbove})`}>
                    observed {d.composition.accumulation.observedCount} / threshold{" "}
                    {d.composition.accumulation.threshold} —{" "}
                    {d.composition.accumulation.applied ? (
                      <Badge tone="amber">applied</Badge>
                    ) : (
                      <Badge tone="gray">not applied</Badge>
                    )}
                  </Row>
                )}
                {d.composition.agentUplift && (
                  <Row label="Agent uplift">
                    via {d.composition.agentUplift.appliedVia.replace(/_/g, " ")}
                    {d.composition.agentUplift.selfApproveFloorApplied &&
                      " · self-approve floor applied"}
                  </Row>
                )}
                <Row label="Final tier">
                  <span className="text-sm font-bold text-indigo-700">
                    Tier {d.composition.finalTier}
                  </span>
                </Row>
              </dl>
            </section>
          )}

          {/* Templated explanation — verbatim */}
          <section>
            <h3 className="mb-2 text-sm font-semibold text-gray-900">
              Explanation{" "}
              <span className="font-normal text-gray-400">
                (template-generated from the derivation, never LLM-written)
              </span>
            </h3>
            <blockquote className="rounded-lg border-l-4 border-indigo-300 bg-indigo-50/50 px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap text-gray-800">
              {d.explanation}
            </blockquote>
          </section>

          <p className="text-xs text-gray-400">
            Policy {shortHash(d.policy.contentHash)} v{d.policy.version} · subject{" "}
            {d.subject.initiatorKind} {d.subject.initiator}
            {d.subject.onBehalfOf ? ` on behalf of ${d.subject.onBehalfOf}` : ""} ·{" "}
            {d.documents.length} document(s)
          </p>
        </>
      )}
    </div>
  );
}
