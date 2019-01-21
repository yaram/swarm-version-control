import * as program from 'commander';
import * as winston from 'winston';
import * as fs from 'fs';
import * as path from 'path';
import {keccak256} from 'js-sha3';

const logger = winston.createLogger({
    level: 'info',
    format: winston.format.cli(),
    transports: [
        new winston.transports.Console()
    ]
});

program
    .version('0.1.0')
    .option('--repo [path]', 'local repository directory', '.');

program
    .command('init')
    .description('initialize a new repository')
    .action(() => {
        const repositoryPath = path.resolve(program.repo);

        if(!fs.existsSync(repositoryPath)){
            logger.error(`Repository directory at ${repositoryPath} does not exist`);
            process.exit(1);
        }

        const dataPath = path.join(repositoryPath, '.swarmvc');

        if(fs.existsSync(dataPath)){
            logger.error('A repository already exists in this directory');
            process.exit(1);
        }

        fs.mkdirSync(dataPath);
        fs.mkdirSync(path.join(dataPath, 'cache'));

        logger.info(`Initialized repository in ${repositoryPath}`);
    });

function cacheDirectory(directoryPath: string, cacheDirectoryPath: string, ignoring?: [RegExp]): string{
    const children = fs.readdirSync(directoryPath);

    let text = '';

    children.forEach((child) => {
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

            const stats = fs.statSync(childPath);

            if(stats.isDirectory()){
                const hash = cacheDirectory(childPath, cacheDirectoryPath);

                text += `${child}/: ${hash}\n`;
            }else if(stats.isFile()){
                const data = fs.readFileSync(childPath);

                const hash = keccak256(data);

                const cachePath = path.join(cacheDirectoryPath, hash);
                if(!fs.existsSync(cachePath)){
                    fs.writeFileSync(cachePath, data);
                }

                text += `${child}: ${hash}\n`;
            }
        }
    });

    const hash = keccak256(text);

    const cachePath = path.join(cacheDirectoryPath, hash);
    if(!fs.existsSync(cachePath)){
        fs.writeFileSync(cachePath, text);
    }

    return hash;
}

program
    .command('commit <message>')
    .description('create a new commit')
    .action((message: string) => {
        const repositoryPath = path.resolve(program.repo);

        if(!fs.existsSync(repositoryPath)){
            logger.error(`Repository directory at ${repositoryPath} does not exist`);
            process.exit(1);
        }

        const dataPath = path.join(repositoryPath, '.swarmvc');

        if(!fs.existsSync(dataPath)){
            logger.error('No repository exists in this directory');
            process.exit(1);
        }

        const cachePath = path.join(dataPath, 'cache');

        const treeHash = cacheDirectory(repositoryPath, cachePath, [/\.swarmvc/g]);

        let text = `${treeHash}\n\n${message}`;

        const hash = keccak256(text);

        const commitPath = path.join(cachePath, hash);

        if(fs.existsSync(commitPath)){
            logger.error(`Commit ${hash} already exists`);
            process.exit(1);
        }

        fs.writeFileSync(commitPath, text);

        logger.info(`Created commit ${hash}`);
    })

program.parse(process.argv);