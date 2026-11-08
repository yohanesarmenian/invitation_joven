// Read-only hosted regression: uses the workflow's own token, never a PAT.
import { execFileSync } from "node:child_process";
import {
  github,
  repository,
  owner,
  verifyProductionProtection,
} from "./release-authority.mjs";

if (process.env.GITHUB_REPOSITORY !== repository || !process.env.GH_TOKEN) {
  console.error("PROTECTION_CHECK_CONTEXT_INVALID");
  process.exitCode = 1;
} else {
  const endpoints = {
    "/environments/production": "PRODUCTION_ENVIRONMENT",
    "/environments/production/deployment-branch-policies":
      "DEPLOYMENT_BRANCH_POLICIES",
  };
  let reads = [],
    shapes = [];
  const transport = async (url, init) => {
    const started = Date.now();
    const parsed = new URL(url);
    const path = parsed.pathname.replace(`/repos/${repository}`, "");
    if (
      parsed.origin !== "https://api.github.com" ||
      !Object.hasOwn(endpoints, path) ||
      (init.method && init.method !== "GET")
    )
      throw Error("Read-only endpoint boundary");
    try {
      const response = await fetch(url, init);
      reads.push({ endpoint: endpoints[path], httpStatus: response.status });
      return response;
    } catch (error) {
      const allowed = [
        "ECONNRESET",
        "UND_ERR_SOCKET",
        "ETIMEDOUT",
        "UND_ERR_CONNECT_TIMEOUT",
        "ECONNREFUSED",
      ];
      reads.push({
        endpoint: endpoints[path],
        transportCode: allowed.includes(error.cause?.code)
          ? error.cause.code
          : "OMITTED",
        errorType: ["TypeError", "TimeoutError", "AbortError"].includes(
          error.name,
        )
          ? error.name
          : "OMITTED",
        elapsedMs: Date.now() - started,
        signalAborted: init.signal.aborted,
      });
      throw Error("Read-only transport failed");
    }
  };
  const api = github(process.env.GH_TOKEN, transport);
  const get = async (path) => {
    if (!Object.hasOwn(endpoints, path))
      throw Error("Read-only endpoint boundary");
    const result = await api(path);
    const rules = Array.isArray(result?.protection_rules)
      ? result.protection_rules
      : [];
    const reviewers = rules.find(
      (r) => r?.type === "required_reviewers",
    )?.reviewers;
    shapes.push(
      path === "/environments/production"
        ? {
            endpoint: endpoints[path],
            environmentIdentityValid:
              result?.name === "production" && Number.isSafeInteger(result?.id),
            protectionRulesIsArray: Array.isArray(result?.protection_rules),
            reviewerCount: Array.isArray(reviewers) ? reviewers.length : null,
            exactOwnerReviewer:
              Array.isArray(reviewers) &&
              reviewers.length === 1 &&
              reviewers[0]?.type === "User" &&
              reviewers[0]?.reviewer?.id === owner.id &&
              reviewers[0]?.reviewer?.login === owner.login,
            branchPolicyModeValid:
              result?.deployment_branch_policy?.protected_branches === false &&
              result?.deployment_branch_policy?.custom_branch_policies === true,
          }
        : {
            endpoint: endpoints[path],
            policiesIsArray: Array.isArray(result?.branch_policies),
            policyCount: Array.isArray(result?.branch_policies)
              ? result.branch_policies.length
              : null,
            exactMasterBranch:
              Array.isArray(result?.branch_policies) &&
              result.branch_policies.length === 1 &&
              result.branch_policies[0]?.name === "master" &&
              result.branch_policies[0]?.type === "branch",
          },
    );
    return result;
  };
  async function check(mode) {
    reads = [];
    shapes = [];
    try {
      await verifyProductionProtection(get);
      console.log(
        JSON.stringify({
          check: "PRODUCTION_PROTECTION",
          mode,
          status: "SUCCEEDED",
          reads,
          shapes,
        }),
      );
      return true;
    } catch {
      console.error(
        JSON.stringify({
          check: "PRODUCTION_PROTECTION",
          mode,
          status: "FAILED",
          reads,
          shapes,
        }),
      );
      process.exitCode = 1;
      return false;
    }
  }
  if (await check("BASELINE")) {
    // Reproduce the failed prepare's 89 seconds of synchronous registry work.
    // This is a controlled idle-connection regression, not a retry or deploy.
    execFileSync(process.execPath, ["-e", "setTimeout(() => {}, 95000)"], {
      stdio: "ignore",
      timeout: 100000,
      windowsHide: true,
    });
    await check("AFTER_SYNCHRONOUS_REGISTRY_DELAY");
  }
}
