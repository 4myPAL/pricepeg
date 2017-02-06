import PricePeg from "./PricePeg";
import history from "./history";
import SetupWizard from "./SetupWizard";
import CryptoConverter from "./data/CryptoConverter";
import {logPegMessage} from "./data/Utils";
import {defaultConfig, setConfig, getConfig} from "./config";
import {PegConfig, ConfiguredPeg} from "./common";


//init the default config object
setConfig(defaultConfig);

//accept config overrides from command line
let configOverride = null;
try {
  if (process.env.CONFIG) {
    configOverride = JSON.parse(process.env.CONFIG);
    setConfig(configOverride);
    logPegMessage("Loaded config from command line: " + JSON.stringify(configOverride));
  }
} catch (e) {
  logPegMessage("WARNING: Unable to parse config override from commandline.");
}

let express = require('express'),
  app = express(),
  server = require('http').createServer(app);

let config = getConfig();

let setupWizard = new SetupWizard();
setupWizard.setup("./config.ini", configOverride).then((configData: ConfiguredPeg) => {
  setConfig(configData.config);
  logPegMessage("TRY TO START PEG.");
  let peg = new PricePeg(getConfig(), configData.converters);
  peg.start();

  let PORT = config.httpport;
  app.use('/', express.static(__dirname + '/static'));
  app.all('/', function (req, res) {
    history(req, res, peg);
  });

  server.listen(PORT);
},
(rejectReason) => {
  logPegMessage("Error loading config: " + JSON.stringify(rejectReason));
});

