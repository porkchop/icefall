declare const __COMMIT_HASH__: string;
declare const __RULESET_VERSION__: string;

export const PLACEHOLDER_RULESET_VERSION = "phase1-placeholder-do-not-share";

export const commitHash: string =
  typeof __COMMIT_HASH__ !== "undefined" ? __COMMIT_HASH__ : "dev0000";

export const rulesetVersion: string =
  typeof __RULESET_VERSION__ !== "undefined"
    ? __RULESET_VERSION__
    : PLACEHOLDER_RULESET_VERSION;
