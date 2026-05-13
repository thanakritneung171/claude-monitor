export function todayBkk(): string {
	return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
}

export function firstOfMonthBkk(): string {
	const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Bangkok' }));
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

export function firstOfYearBkk(): string {
	const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Bangkok' }));
	return `${d.getFullYear()}-01-01`;
}

export function dateToMs(dateStr: string, endOfDay = false): number {
	const time = endOfDay ? 'T23:59:59.999+07:00' : 'T00:00:00+07:00';
	return new Date(dateStr + time).getTime();
}
