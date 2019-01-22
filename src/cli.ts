import * as program from 'commander';
import * as winston from 'winston';
import * as fs from 'mz/fs';
import * as path from 'path';
import Bzz from '@erebos/api-bzz-node';

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
        await fs.mkdir(path.join(dataPath, 'cache'));

        logger.info(`Initialized repository in ${repositoryPath}`);
    });

async function uploadAndCacheObject(data: string | Buffer, bzz: Bzz, cacheDirectoryPath: string): Promise<string>{
    const hash = await bzz.upload(data);

    const cachePath = path.join(cacheDirectoryPath, hash);

    if(!await fs.exists(cachePath)){
        await fs.writeFile(cachePath, data);
    }

    return hash;
}

async function uploadAndCacheDirectory(directoryPath: string, cacheDirectoryPath: string, bzz: Bzz, ignoring?: [RegExp]): Promise<string>{
    const children = await fs.readdir(directoryPath);

    let text = '';

    for(let i = 0; i < children.length; i++){
        const child = children[i];
        let shouldIgnore = false;

        if(ignoring !== undefined){
            ignoring.forEach((pattern) => {
                if(pattern.test(child)){
                    shouldIgnore = true;
                }
            });
        }

        if(!shouldIgnore){
            const childPath = path.join(directoryPath, child);

            const stats = await fs.stat(childPath);

            if(stats.isDirectory()){
                const hash = await uploadAndCacheDirectory(childPath, cacheDirectoryPath, bzz);

                text += `${child}/: ${hash}\n`;
            }else if(stats.isFile()){
                const data = await fs.readFile(childPath);

                const hash = await uploadAndCacheObject(data, bzz, cacheDirectoryPath);

                text += `${child}: ${hash}\n`;
            }
        }
    }

    const hash = await uploadAndCacheObject(text, bzz, cacheDirectoryPath);

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

        const commitText = `${treeHash}\n\n${message}`;

        const commitHash = await uploadAndCacheObject(commitText, bzz, cacheDirectoryPath);

        logger.info(`Created commit ${commitHash}`);
    })

program.parse(process.argv);