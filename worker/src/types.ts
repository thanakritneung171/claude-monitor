/// <reference types="@cloudflare/workers-types" />

export interface Env {
	DB: D1Database;
	API_KEY: string;
	LOGTO_ENDPOINT: string;
	LOGTO_APP_ID: string;
	LOGTO_APP_SECRET: string;
	LOGTO_REDIRECT_URI: string;
	LOGTO_POST_LOGOUT_REDIRECT_URI: string;
}

export interface ApiLog {
	id: string;
	ts: number;
	client: string;
	account_email: string;
	client_ip: string;
	machine_name: string;
	model: string;
	prompt: string;
	prompt_chars: number;
	response_chars: number;
	input_tokens: number;
	output_tokens: number;
	cache_creation_tokens: number;
	cache_read_tokens: number;
	total_tokens: number;
	cost_usd: number;
}

export interface IpIdentity {
	ip: string;
	email: string;
	name: string;
	uuid: string;
	updated_ms: number;
}

export interface Filters {
	period: string;
	dateFrom: string;
	dateTo: string;
	model: string;
	account: string;
	client: string;
	page: number;
	perPage: number | null; // null = all
}

export interface Totals {
	total: number;
	totalInput: number;
	totalOutput: number;
	totalCacheRead: number;
	totalCacheCreate: number;
	totalCost: number;
}

export interface ByModel { model: string; n: number; tokens: number; cost: number; }
export interface ByClient { client: string; n: number; cost: number; }
export interface ByAccount { account_email: string; n: number; cost: number; }

// ─── Auth ─────────────────────────────────────────────────────────────────────
// Identity is owned by Logto. We only keep the session row + the claims we need.
export interface SessionUser {
	id: string;     // sessionId (cookie value)
	sub: string;    // Logto user id (from id_token `sub` claim)
	email: string;
}
