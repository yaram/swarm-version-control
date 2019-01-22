import * as program from 'commander';
import * as winston from 'winston';
import * as fs from 'mz/fs';
import * as path from 'path';
import Bzz from '@erebos/api-bzz-node';
import * as stringify from 'json-stable-stringify';

interface Commit{
    tree: string,
    parents: string[],
    message: string
}

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
    const hash = await bzz.upload(data);

    if(!await fs.exists(cacheDirectoryPath)){
        await fs.mkdir(cacheDirectoryPath);
    }

    const cachePath = path.join(cacheDirectoryPath, hash);

    if(!await fs.exists(cachePath)){
        await fs.writeFile(cachePath, data);
    }

    return hash;
}

async function uploadAndCacheDirectory(directoryPath: string, cacheDirectoryPath: string, bzz: Bzz, ignoring?: [RegExp]): Promise<string>{
    const childNames = await fs.readdir(directoryPath);

    let children: {[key: string]: string;} = {};

    for(let i = 0; i < childNames.length; i++){
        const childName = childNames[i];
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

program
    .command('commit <message>')
    .description('create a new commit')
    .action(async (message: string) => {
        const bzz = new Bzz({
            url: program.bzz
        });

        const repositoryPath = path.resolve(program.repo);

        if(!await fs.exists(repositoryPath)){
            logger.error(`Repository directory at ${repositoryPath} does not exist`);
            process.exit(1);
        }

        const dataPath = path.join(repositoryPath, '.swarmvc');

        if(!await fs.exists(dataPath)){
            logger.error('No repository exists in this directory');
            process.exit(1);
        }

        const cacheDirectoryPath = path.join(dataPath, 'cache');

        const treeHash = await uploadAndCacheDirectory(repositoryPath, cacheDirectoryPath, bzz, [/\.swarmvc/g]);

        const headPath = path.join(dataPath, 'head');

        let commit: Commit;
        if(await fs.exists(headPath)){
            const parentCommitHash = await fs.readFile(headPath, 'utf8');

            commit = {
                tree: treeHash,
                parents: [parentCommitHash],
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

        await fs.writeFile(headPath, commitHash);

        logger.info(`Created commit ${commitHash}`);
    })

program.parse(process.argv);