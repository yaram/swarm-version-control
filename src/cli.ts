import * as program from 'commander';
import * as winston from 'winston';
import * as fs from 'fs';
import * as path from 'path';

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
        fs.mkdirSync(path.join(dataPath, 'objects'));

        logger.info(`Initialized repository in ${repositoryPath}`);
    });

program.parse(process.argv);