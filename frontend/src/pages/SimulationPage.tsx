import { useEffect, useState } from 'react';
import { ApiError } from '../lib/api';
import { OiCsvDropzone } from '../components/OiCsvDropzone';
import { PassFailReport } from '../components/PassFailReport';
import { RunArtifactsPanel } from '../components/RunArtifactsPanel';
import { RunConfigForm } from '../components/RunConfigForm';
import { RunDataInspector } from '../components/RunDataInspector';
import { RunsList } from '../components/RunsList';
import {
  useGenerateReport,
  useGenerateRun,
  useRun,
  useRuns,
  useUploadOiCsv,
  useUploadRun,
} from '../hooks/useSimulation';

export function SimulationPage() {
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

  const runsQuery = useRuns();
  const runQuery = useRun(selectedRunId);

  const generate = useGenerateRun();
  const upload = useUploadRun();
  const uploadCsv = useUploadOiCsv();
  const report = useGenerateReport();

  // When a new run is generated, auto-select it.
  useEffect(() => {
    if (generate.data) setSelectedRunId(generate.data.runId);
  }, [generate.data]);

  const summary = runQuery.data?.summary;
  const uploadResult = runQuery.data?.upload;
  const reportData = runQuery.data?.report;

  return (
    <div className="mx-auto max-w-4xl xl:max-w-7xl">
      <div className="mb-2">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Identity Resolution Simulation</h2>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Generate an answer-key dataset, push intentionally dirty versions to HubSpot/Stripe/Shopify,
          then grade Organic Intelligence&apos;s grouping of the result.
        </p>
      </div>

      <div className="my-6">
        <RunsList
          runs={runsQuery.data ?? []}
          selectedRunId={selectedRunId}
          onSelect={setSelectedRunId}
        />
      </div>

      {/* Configure step: shown when no run is selected */}
      {!selectedRunId && (
        <section className="rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-900/50">
          <h3 className="mb-4 text-lg font-semibold text-gray-900 dark:text-white">New simulation run</h3>
          <RunConfigForm
            isLoading={generate.isPending}
            onSubmit={(options) => generate.mutate(options)}
          />
          {generate.error && <ErrorBox error={generate.error} />}
        </section>
      )}

      {/* Run detail: shown when a run is selected */}
      {selectedRunId && summary && (
        <div className="space-y-6">
          {/* Stage 1: generated → uploaded */}
          <section className="rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-900/50">
            <header className="mb-4 flex items-start justify-between">
              <div>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                  Generated datasets
                </h3>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Answer key: {summary.counts.answerKey} · Stripe: {summary.counts.stripe} · HubSpot:{' '}
                  {summary.counts.hubspot} · Shopify: {summary.counts.shopify}
                </p>
              </div>
              <span className="rounded bg-gray-100 px-2 py-0.5 font-mono text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                {summary.runId}
              </span>
            </header>

            <RunArtifactsPanel runId={summary.runId} stage={summary.stage} />

            <RunDataInspector runId={summary.runId} />

            {summary.stage === 'generated' && (
              <div className="mt-4">
                <button
                  type="button"
                  disabled={upload.isPending}
                  onClick={() => upload.mutate(summary.runId)}
                  className="w-full rounded-lg bg-teal-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-teal-500 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {upload.isPending ? 'Uploading to all platforms…' : 'Upload to all platforms'}
                </button>
                {upload.error && <ErrorBox error={upload.error} />}
              </div>
            )}
          </section>

          {/* Stage 2: uploaded — show external IDs and CSV upload */}
          {(summary.stage === 'uploaded' ||
            summary.stage === 'oi-uploaded' ||
            summary.stage === 'reported') && uploadResult && (
            <section className="rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-900/50">
              <h3 className="mb-2 text-lg font-semibold text-gray-900 dark:text-white">
                Upload result
              </h3>
              <p className="mb-4 text-xs text-gray-500 dark:text-gray-400">
                {uploadResult.mappings.length} records uploaded
                {uploadResult.errors.length > 0 && (
                  <span className="ml-1 text-red-600 dark:text-red-400">
                    · {uploadResult.errors.length} errors
                  </span>
                )}
              </p>
              {uploadResult.errors.length > 0 && (
                <ul className="mb-4 space-y-1 text-xs text-red-600 dark:text-red-300">
                  {uploadResult.errors.slice(0, 5).map((e, i) => (
                    <li key={i} className="rounded bg-red-500/10 px-2 py-1">
                      {e}
                    </li>
                  ))}
                  {uploadResult.errors.length > 5 && (
                    <li className="opacity-60">… {uploadResult.errors.length - 5} more</li>
                  )}
                </ul>
              )}

              {summary.stage === 'uploaded' && (
                <div>
                  <p className="mb-3 text-sm text-gray-600 dark:text-gray-300">
                    Run Organic Intelligence against the org, then upload the result CSV here.
                  </p>
                  <OiCsvDropzone
                    isLoading={uploadCsv.isPending}
                    onUpload={(file) => uploadCsv.mutate({ runId: summary.runId, file })}
                  />
                  {uploadCsv.error && <ErrorBox error={uploadCsv.error} />}
                </div>
              )}
            </section>
          )}

          {/* Stage 3: oi-uploaded — generate report */}
          {summary.stage === 'oi-uploaded' && (
            <section className="rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-900/50">
              <h3 className="mb-2 text-lg font-semibold text-gray-900 dark:text-white">
                Generate report
              </h3>
              <p className="mb-4 text-sm text-gray-600 dark:text-gray-300">
                Compare the OI grouping against the answer key.
              </p>
              <button
                type="button"
                disabled={report.isPending}
                onClick={() => report.mutate(summary.runId)}
                className="w-full rounded-lg bg-teal-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-teal-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {report.isPending ? 'Computing report…' : 'Generate pass/fail report'}
              </button>
              {report.error && <ErrorBox error={report.error} />}
            </section>
          )}

          {/* Stage 4: reported — show pass/fail */}
          {summary.stage === 'reported' && reportData && (
            <section className="rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-900/50">
              <h3 className="mb-4 text-lg font-semibold text-gray-900 dark:text-white">Pass/fail report</h3>
              <PassFailReport report={reportData} />
            </section>
          )}
        </div>
      )}
    </div>
  );
}

function ErrorBox({ error }: { error: Error | ApiError }) {
  return (
    <div className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-600 dark:text-red-400">
      {error.message}
    </div>
  );
}
