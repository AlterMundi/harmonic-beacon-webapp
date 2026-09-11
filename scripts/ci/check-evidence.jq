[.checks[]?.check_runs[]? as $check
  | (.suites | map(select(.id == $check.check_suite.id)) | first // null) as $suite
  | ([.jobs[]? as $job_bundle
      | $job_bundle.pages[]?.jobs[]? as $job
      | select($job.run_id == $job_bundle.run_id)
      | select((try ($job.check_run_url | capture("/check-runs/(?<id>[0-9]+)$").id | tonumber) catch -1) == $check.id)
      | $job_bundle.run as $workflow
      | select($workflow.id == $job_bundle.run_id and $workflow.run_attempt == $job_bundle.run_attempt)
      | {workflow:$workflow,job:$job,run_attempt:$job_bundle.run_attempt}
    ] | if length == 1 then .[0] else null end) as $binding
  | {
      id: $check.id,
      name: $check.name,
      head_sha: $check.head_sha,
      status: $check.status,
      conclusion: $check.conclusion,
      completed_at: $check.completed_at,
      started_at: $check.started_at,
      created_at: $check.created_at,
      app: {id: $check.app.id, slug: $check.app.slug},
      check_suite: (if $suite == null then null else {
        id: $suite.id,
        head_sha: $suite.head_sha,
        app: {id: $suite.app.id, slug: $suite.app.slug}
      } end),
      workflow_run: (if $binding == null then null else {
        id: $binding.workflow.id,
        check_suite_id: $binding.workflow.check_suite_id,
        run_attempt: $binding.workflow.run_attempt,
        name: $binding.workflow.name,
        path: $binding.workflow.path,
        event: $binding.workflow.event,
        head_sha: $binding.workflow.head_sha,
        run_started_at: $binding.workflow.run_started_at,
        pull_requests: $binding.workflow.pull_requests
      } end),
      workflow_job: (if $binding == null then null else {
        id: $binding.job.id,
        run_id: $binding.job.run_id,
        run_attempt: $binding.run_attempt,
        check_run_id: $check.id,
        head_sha: $binding.job.head_sha,
        name: $binding.job.name,
        status: $binding.job.status,
        conclusion: $binding.job.conclusion,
        started_at: $binding.job.started_at,
        completed_at: $binding.job.completed_at
      } end)
    }
]
