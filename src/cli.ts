import * as program from 'commander';
import BzzApi from '@erebos/api-bzz-node';

program
    .version('0.1.0')
    .option('--bzzUrl [url]', 'Swarm HTTP API endpoint', 'https://swarm-gateways.net')
    .parse(process.argv);

const bzz = new BzzApi({
    url: program.bzzUrl
});

bzz.download('theswarm.eth').then((res) => {
    return res.text();
}).then((text) => {
    console.log(text);
});