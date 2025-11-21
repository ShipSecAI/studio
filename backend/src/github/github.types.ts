export interface GithubRepositoryInfo {
  owner: string;
  name: string;
  fullName: string;
}

export interface GithubRefInfo {
  sha: string | null;
  ref: string | null;
  repoFullName?: string | null;
  repoOwner?: string | null;
}

export interface GithubPullRequestInfo {
  number: number;
  head: GithubRefInfo;
  base: GithubRefInfo;
  author: string | null;
  labels: string[];
}

export interface GithubEventEnvelope {
  event: string;
  deliveryId: string;
  installationId: number | null;
  repository: GithubRepositoryInfo;
  pullRequest: GithubPullRequestInfo | null;
  dedupeKey: string;
  rawPayload: unknown;
}
