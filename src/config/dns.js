import dns from 'node:dns';
import 'dotenv/config';
const servers = process.env.DNS_SERVERS?.split(',').map(value => value.trim()).filter(Boolean);
if (servers?.length) dns.setServers(servers);

