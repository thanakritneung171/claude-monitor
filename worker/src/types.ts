/// <reference types="@cloudflare/workers-types" />

export interface Env {
	DB: D1Database;
	API_KEY: string;
}

export interface ApiLog {
	id: string;
	ts: number;
	client: string;
	account_email: string;
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
export type Role = 'admin' | 'viewer';

export interface User {
	id: string;
	email: string;
	password_hash: string;
	role: Role;
	created_at: number;
	last_login_at: number | null;
	status: 'active' | 'disabled';
}

export interface Session {
	id: string;
	user_id: string;
	created_at: number;
	expires_at: number;
	ip: string | null;
	user_agent: string | null;
}
