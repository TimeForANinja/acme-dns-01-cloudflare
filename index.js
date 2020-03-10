'use strict';

const util = require('util');
const resolver = new (require('dns')).Resolver();
resolver.setServers(['1.1.1.1']);


const cloudflare = require('cloudflare');

class Challenge{
	constructor(options){
		this.options = options;
		this.client = new cloudflare({
			email: options.email,
			key: options.key,
			token: options.token
		});
	}

	static create(config){
		return new Challenge(Object.assign(config, this.options));
	}

	async init(){
		return Promise.resolve(null);
	}

	async set(args){
		if(!args.challenge){
			return Promise.reject("You must be using Greenlock v2.7+ to use acme-dns-01-cloudflare");
		}
		try{
			const fullRecordName = args.challenge.dnsPrefix + '.' + args.challenge.dnsZone;
			const zone = await this.getZoneForDomain(args.challenge.dnsZone);
			if(!zone){
				return Promise.reject(`Could not find a zone for '${fullRecordName}'.`);
			}
			// add record
			await this.client.dnsRecords.add(zone.id, {
				type: 'TXT',
				name: fullRecordName,
				content: args.challenge.dnsAuthorization,
				ttl: 120
			});
			if(this.options.verifyPropagation){
				await Challenge.verifyPropagation(args.challenge, this.options.waitFor, this.options.retries);
			}
			return null;
		}catch(err){
			throw new Error(err);
		}
	}

	async remove(args){
		if(!args.challenge){
			return Promise.reject("You must be using Greenlock v2.7+ to use acme-dns-01-cloudflare");
		}
		try{
			const fullRecordName = args.challenge.dnsPrefix + '.' + args.challenge.dnsZone;
			const zone = await this.getZoneForDomain(args.challenge.dnsZone);
			if(!zone){
				return Promise.reject(`Could not find a zone for '${fullRecordName}'.`);
			}
			const records = await this.getTxtRecords(zone, fullRecordName);
			if(!records.length){
				return Promise.reject(`No TXT records found for ${fullRecordName}`);
			}
			for(const record of records){
				if(record.name === fullRecordName && record.content === args.challenge.dnsAuthorization){
					await this.client.dnsRecords.del(zone.id, record.id);
				}
			}
			// allow time for deletion to propagate
			await Challenge.verifyPropagation(Object.assign({}, args.challenge, {removed: true}));
			return null;
		}catch(err){
			throw new Error(err);
		}
	}

	/* implemented for testing purposes */
	async get(args){
		if(!args.challenge){
			return Promise.reject("You must be using Greenlock v2.7+ to use acme-dns-01-cloudflare");
		}
		try{
			const fullRecordName = args.challenge.dnsPrefix + '.' + args.challenge.dnsZone;
			const zone = await this.getZoneForDomain(fullRecordName);
			if(!zone){
				return Promise.reject(`Could not find a zone for '${fullRecordName}'.`);
			}
			const records = await this.getTxtRecords(zone, fullRecordName);
			if(!records.length){
				return null;
			}
			// find the applicable record if multiple
			let foundRecord = null;
			for(const record of records){
				if(record.name === fullRecordName && record.content === args.challenge.dnsAuthorization){
					foundRecord = record;
				}
			}
			if(!foundRecord){
				return null;
			}
			return {
				dnsAuthorization: foundRecord.content
			};

		}catch(err){
			// could not get record
			return null;
		}
	}

	async zones(args){ // eslint-disable-line no-unused-vars
		try{
			const zones = [];
			for await(const zone of consumePages(pagination =>
				this.client.zones.browse(pagination)
			)){
				zones.push(zone.name);
			}
			return zones;
		}catch(err){
			throw new Error(err);
		}
	}

	static async verifyPropagation(challenge, waitFor = 10000, retries = 30){
		const fullRecordName = challenge.dnsPrefix + '.' + challenge.dnsZone;
		for(let i = 0; i < retries; i++){
			try{
				const records = await resolveTxt(fullRecordName);
				const verifyCheck = challenge.dnsAuthorization;
				if(challenge.removed === true){
					// we're explicitly looking for the record not to exist
					if(records.includes(verifyCheck)){
						throw new Error(`DNS record deletion not yet propagated for ${fullRecordName}`);
					}
				}
				if(!records.includes(verifyCheck)){
					if(challenge.removed === true){
						return;
					}
					throw new Error(`Could not verify DNS for ${fullRecordName}`);
				}
				return;
			}catch(err){
				if(err.code === 'ENODATA' && challenge.removed === true){
					return;
				}
				console.error(err);
				console.log(`Waiting for ${waitFor} ms before attempting propagation verification retry ${i + 1} / ${retries}.`);
				await delay(waitFor);
			}
		}
		throw new Error(`Could not verify challenge for '${fullRecordName}'.`);
	}

	async getZoneForDomain(domain){
		for await(const zone of consumePages(pagination =>
			this.client.zones.browse(pagination)
		)){
			if(domain.endsWith(zone.name)){
				return zone;
			}
		}
		return null;
	}

	async getTxtRecords(zone, name){
		const records = [];

		for await(const txtRecord of consumePages(pagination =>
			this.client.dnsRecords.browse(zone.id, {
				...pagination,
				type: 'TXT',
				name
			})
		)){
			if(txtRecord.name === name){
				records.push(txtRecord);
			}
		}

		return records;
	}
}

const resolveTxtPromise = util.promisify(resolver.resolveTxt).bind(resolver);
async function resolveTxt(fqdn){
	const records = await resolveTxtPromise(fqdn);
	return records.map(r => r.join(' '));
}

/* Thanks to https://github.com/buschtoens/le-challenge-cloudflare for this great pagination implementation */
async function* consumePages(loader, pageSize = 10){
	for(let page = 1, didReadAll = false; !didReadAll; page++){
		const response = await loader({
			per_page: pageSize,
			page
		});

		if(response.success){
			yield* response.result;
		}else{
			const error = new Error('Cloudflare API error.');
			error.errors = response.errors;
			throw error;
		}

		didReadAll = page >= response.result_info.total_pages;
	}
}

function delay(ms){
	return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = Challenge;