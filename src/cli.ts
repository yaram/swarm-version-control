import * as program from 'commander';
import * as winston from 'winston';
import * as fs from 'mz/fs';
import * as path from 'path';
import Bzz from '@erebos/api-bzz-node';
import * as stringify from 'json-stable-stringify';
import * as swarmHash from 'swarmhash3';

const logger = winston.createLogger({
    level: 'info',
    format: winston.format.cli(),
    transports: [
        new winston.transports.Console()
    ]
});

program
    .version('0.1.0')
    .option('--repo [path]', 'local repository directory', '.')
    .option('--bzz [url]', 'Swarm HTTP API endpoint', 'https://swarm-gateways.net');

program
    .command('init')
    .description('initialize a new repository')
    .action(async () => {
        const repositoryPath = path.resolve(program.repo);

        if(!await fs.exists(repositoryPath)){
            logger.error(`Repository directory at ${repositoryPath} does not exist`);
            process.exit(1);
        }

        const dataPath = path.join(repositoryPath, '.swarmvc');

        if(await fs.exists(dataPath)){
            logger.error('A repository already exists in this directory');
            process.exit(1);
        }

        await fs.mkdir(dataPath);

        logger.info(`Initialized repository in ${repositoryPath}`);
    });

async function uploadAndCacheObject(data: string | Buffer, bzz: Bzz, cacheDirectoryPath: string): Promise<string>{
    const hash = swarmHash(data);

    if(!await fs.exists(cacheDirectoryPath)){
        await fs.mkdir(cacheDirectoryPath);
    }

    const cachePath = path.join(cacheDirectoryPath, hash);

    if(!await fs.exists(cachePath)){
        const uploadedHash = await bzz.upload(data);

        if(uploadedHash !== hash){
            logger.error(`Uploaded hash ${uploadedHash} does not match expected hash ${hash}`);
            process.exit(1);
        }

        await fs.writeFile(cachePath, data);
    }

    return hash;
}

async function uploadAndCacheDirectory(directoryPath: string, cacheDirectoryPath: string, bzz: Bzz, ignoring?: [RegExp]): Promise<string>{
    const childNames = await fs.readdir(directoryPath);

    let children: {[key: string]: string;} = {};

    for(const childName of childNames){
        let shouldIgnore = false;

        if(ignoring !== undefined){
            ignoring.forEach((pattern) => {
                if(pattern.test(childName)){
                    shouldIgnore = true;
                }
            });
        }

        if(!shouldIgnore){
            const childPath = path.join(directoryPath, childName);

            const stats = await fs.stat(childPath);

            if(stats.isDirectory()){
                const hash = await uploadAndCacheDirectory(childPath, cacheDirectoryPath, bzz);

                children[`${childName}/`] = hash;
            }else if(stats.isFile()){
                const data = await fs.readFile(childPath);

                const hash = await uploadAndCacheObject(data, bzz, cacheDirectoryPath);

                children[childName] = hash;
            }
        }
    }

    const childrenJson = stringify(children);

    const hash = await uploadAndCacheObject(childrenJson, bzz, cacheDirectoryPath);

    return hash;
}

async function resolveRepoPathsAndCheck(repo: string): Promise<{repositoryPath: string, dataPath: string}>{
    const repositoryPath = repo;

    if(!await fs.exists(repositoryPath)){
        logger.error(`Repository directory at ${repositoryPath} does not exist`);
        process.exit(1);
    }

    const dataPath = path.join(repositoryPath, '.swarmvc');

    if(!await fs.exists(dataPath)){
        logger.error('No repository exists in this directory');
        process.exit(1);
    }

    return {
        repositoryPath,
        dataPath
    };
}

program
    .command('commit <message>')
    .description('create a new commit')
    .action(async (message: string) => {
        const bzz = new Bzz({
            url: program.bzz
        });

        const {repositoryPath, dataPath} = await resolveRepoPathsAndCheck(program.repo);

        const cacheDirectoryPath = path.join(dataPath, 'cache');

        const treeHash = await uploadAndCacheDirectory(repositoryPath, cacheDirectoryPath, bzz, [/\.swarmvc/g]);

        const infoPath = path.join(dataPath, 'info.json');

        let info: {
            head?: string,
            branches?: {[key: string]: string;}
        };

        if(await fs.exists(infoPath)){
            const infoJson = await fs.readFile(infoPath, 'utf8');

            info = JSON.parse(infoJson);
        }else{
            info = {};
        }

        let commit: {
            tree: string,
            parents: string[],
            message: string
        };

        if(info.head !== undefined){
            let headCommit;

            if(info.branches !== undefined && info.branches[info.head] == undefined){
                headCommit = info.head;
            }else{
                headCommit = info.branches[info.head];
            }

            commit = {
                tree: treeHash,
                parents: [info.head],
                message: message
            };
        }else{
            commit = {
                tree: treeHash,
                parents: [],
                message: message
            };
        }

        const commitJson = stringify(commit);

        const commitHash = await uploadAndCacheObject(commitJson, bzz, cacheDirectoryPath);

        if(info.branches === undefined){
            info.branches = {
                master: commitHash
            };

            info.head = 'master';
        }else if(info.branches[info.head] == undefined){
            info.head = commitHash;
        }else{
            info.branches[info.head] = commitHash;
        }

        const infoJson = JSON.stringify(info, null, 2);

        await fs.writeFile(infoPath, infoJson);

        logger.info(`Created commit ${commitHash}`);
    })

program
    .command('checkout <commit or branch>')
    .description('move the head to a different branch or commit')
    .action(async (commitLike: string) => { 
        const {repositoryPath, dataPath} = await resolveRepoPathsAndCheck(program.repo);

        const infoPath = path.join(dataPath, 'info.json');

        let info: {
            head?: string,
            branches?: {[key: string]: string;}
        };

        if(await fs.exists(infoPath)){
            const infoJson = await fs.readFile(infoPath, 'utf8');

            info = JSON.parse(infoJson);
        }else{
            info = {};
        }

        info.head = commitLike;

        const infoJson = JSON.stringify(info, null, 2);

        await fs.writeFile(infoPath, infoJson);

        logger.info(`Moved the head to ${commitLike}`);
    });

program
    .command('create-branch <name>')
    .description('create a branch on the current head commit')
    .action(async (name: string) => {
        const {repositoryPath, dataPath} = await resolveRepoPathsAndCheck(program.repo);

        const infoPath = path.join(dataPath, 'info.json');

        let info: {
            head?: string,
            branches?: {[key: string]: string;}
        };

        if(await fs.exists(infoPath)){
            const infoJson = await fs.readFile(infoPath, 'utf8');

            info = JSON.parse(infoJson);
        }else{
            info = {};
        }

        if(info.head === undefined){
            logger.error('No commits have been made yet');
            process.exit(1);
        }

        let commitHash;

        if(info.branches !== undefined && info.branches[info.head] !== undefined){
            commitHash = info.branches[info.head];
        }else{
            commitHash = info.head;
        }

        if(info.branches === undefined){
            info.branches = {};
        }

        info.branches[name] = commitHash;

        info.head = name;

        const infoJson = JSON.stringify(info, null, 2);

        await fs.writeFile(infoPath, infoJson);

        logger.info(`Created branch ${name} at ${commitHash}`);
    });

program.parse(process.argv);