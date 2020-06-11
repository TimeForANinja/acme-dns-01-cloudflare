'use strict';

/* eslint-disable no-process-exit */
if(!process.env.CLOUDFLARE_GLOBAL_KEY && !(process.env.CLOUDFLARE_EMAIL && process.env.CLOUDFLARE_APIKEY)){
	console.error('Missing CLOUDFLARE_GLOBAL_KEY or both CLOUDFLARE_EMAIL and CLOUDFLARE_APIKEY env');
	process.exit(1);
}
if(!process.env.DOMAIN){
	console.error('Missing DOMAIN');
	process.exit(1);
}
const tester = require("acme-dns-01-test");

const type = "dns-01";
const challenger = require("./index.js").create({
	token: process.env.CLOUDFLARE_GLOBAL_KEY,
	email: process.env.CLOUDFLARE_APIMAIL,
	key: process.env.CLOUDFLARE_APIKEY,
	verifyPropagation: true
});

const domain = process.env.DOMAIN;
tester.testZone(type, domain, challenger).then(function(){
	console.info("PASS");
}).catch(function(err){
	console.error("FAIL");
	console.error(err);
	process.exit(1);
});
