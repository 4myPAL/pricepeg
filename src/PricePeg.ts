import {
  logPegMessage,
  logPegMessageNewline,
  getPercentChange,
  readFromFile,
  validateUpdateHistoryLogFormat,
  writeToFile
} from "./data/Utils";
import FixerFiatDataSource from "./data/FixerFiatDataSource";
import {CurrencyConversionType, default as CurrencyConversion} from "./data/CurrencyConversion";
import CryptoConverter from "./data/CryptoConverter";
import * as Q from "q";
import {PricePegModel, HistoryLog, mockPeg, PegConfig} from "./common";
import ConversionDataSource from "./data/ConversionDataSource";
import PoloniexDataSource from "./data/PoloniexDataSource";
import {getConfig} from "./config";

const syscoin = require('syscoin');

interface ConverterCollection {
  [ key: string ]: CryptoConverter;
}

export const conversionKeys = {
  BTCUSD: CurrencyConversionType.CRYPTO.BTC.symbol + CurrencyConversionType.FIAT.USD.symbol,
  SYSBTC: CurrencyConversionType.CRYPTO.SYS.symbol + CurrencyConversionType.CRYPTO.BTC.symbol
};

export default class PricePeg {
  public startTime = null;
  public updateHistory: HistoryLog = [];
  public sysRates: PricePegModel = null;
  public updateInterval = null;

  private fiatDataSource = new FixerFiatDataSource("USD", "US Dollar", "http://api.fixer.io/latest?base=USD"); //used to extrapolate other Fiat/SYS pairs off SYS/USD
  private conversionDataSources: CryptoConverter[] = [];

  private client;

  constructor(public config: PegConfig, public configuredDataProvider: CryptoConverter[]) {
    if (!config.enableLivePegUpdates) {
      this.fiatDataSource.formattedCurrencyConversionData = mockPeg;
    }

    this.client = new syscoin.Client({
      host: config.rpcserver,
      port: config.rpcport,
      user: config.rpcuser,
      pass: config.rpcpassword,
      timeout: config.rpctimeout
    });

    //setup conversions for currencies this peg will support
    //CryptoConverter should only be used for exchanges which there is a direct API for, anything
    //further conversions should happen in subclasses or this class
    let conversion = null;
    let btcUSDExists = false;
    let sysBTCExists = false;
    if(configuredDataProvider != null) {
      for(let i = 0; i < configuredDataProvider.length; i++) {
        this.conversionDataSources[configuredDataProvider[i].key] = configuredDataProvider[i];
        if(configuredDataProvider[i].key == conversionKeys.BTCUSD) {
          btcUSDExists = true;
        }

        if(configuredDataProvider[i].key == conversionKeys.SYSBTC) {
          sysBTCExists = true;
        }
      }
    }

    if(!btcUSDExists) { //always need this data source, just do not display results
      let conversion = new CurrencyConversion(CurrencyConversionType.CRYPTO.BTC.symbol, CurrencyConversionType.CRYPTO.BTC.label, 1, CurrencyConversionType.FIAT.USD.symbol, CurrencyConversionType.FIAT.USD.label, 1);
      this.conversionDataSources[conversionKeys.BTCUSD] = new CryptoConverter(conversion,
        [new ConversionDataSource(conversion, "https://coinbase.com/api/v1/currencies/exchange_rates", "btc_to_usd")], null);
    }

    if(!sysBTCExists) { //always need this data source, just do not display results
      conversion = new CurrencyConversion(CurrencyConversionType.CRYPTO.SYS.symbol, CurrencyConversionType.CRYPTO.SYS.label, 1, CurrencyConversionType.CRYPTO.BTC.symbol, CurrencyConversionType.CRYPTO.BTC.label, 1);
      this.conversionDataSources[conversionKeys.SYSBTC] = new CryptoConverter(conversion,
        [new ConversionDataSource(conversion, "https://bittrex.com/api/v1.1/public/getticker?market=BTC-SYS", "result.Bid"),
          new PoloniexDataSource(conversion, "https://poloniex.com/public?command=returnOrderBook&currencyPair=BTC_SYS&depth=1", "bids")], null);
    }
  }

  start = () => {
    logPegMessage(`Starting PricePeg with config:
                    ${JSON.stringify(this.config)}`);

    if (this.config.enableLivePegUpdates)
      this.client.getInfo((err, info, resHeaders) => {
        if (err) {
          return logPegMessage(`Error: ${err}`);
        }
        logPegMessage(`Syscoin Connection Test. Current Blockheight: ${info.blocks}`);
      });

    this.startTime = Date.now();


    //try to load up any previous data
    this.loadUpdateHistory().then((log) => {
      try {
        let parseLog = JSON.parse(log);

        if (validateUpdateHistoryLogFormat(parseLog)) {
          if (this.config.logLevel.logUpdateLoggingEvents)
            logPegMessage("Peg update history loaded from file and validated.");
          this.updateHistory = parseLog;
        } else {
          if (this.config.logLevel.logUpdateLoggingEvents)
            logPegMessage("Peg update history loaded from file but was INVALID!")
        }
      }catch(e) {
        logPegMessage(`Error loading peg history:  ${JSON.stringify(e)}`);
      }

      this.startUpdateInterval();
    },
    (err) => {
      this.startUpdateInterval();
    });
  };

  stop = () => {
    this.stopUpdateInterval();
  };

  startUpdateInterval = () => {
    this.fiatDataSource.fetchCurrencyConversionData().then((result) => {
      if (!this.config.enablePegUpdateDebug) {
        this.refreshCurrentRates(true);

        this.updateInterval = setInterval(() => {
          this.refreshCurrentRates(true)
        }, this.config.updateInterval * 1000);
      } else {
        this.refreshCurrentRates(true);

        this.updateInterval = setInterval(() => {
          this.checkPricePeg();
        }, this.config.debugPegUpdateInterval * 1000);
      }
    });
  };

  stopUpdateInterval = () => {
    clearInterval(this.updateInterval);
  };

  refreshCurrentRates = (checkForPegUpdate) => {
    let dataSources = [];

    for (let key in this.conversionDataSources) {
      dataSources.push(this.conversionDataSources[key].refreshAverageExchangeRate());
    }

    Q.all(dataSources).then((resultsArr) => {
      this.handleCurrentRateRefreshComplete(checkForPegUpdate);
    });
  };

  handleCurrentRateRefreshComplete = (checkForPegUpdate) => {
    if (this.config.logLevel.logNetworkEvents) {
      //any time we fetch crypto rates, fetch the fiat rates too
      logPegMessage(`Exchange rate refresh complete, check for peg value changes == ${checkForPegUpdate}`);
      logPegMessageNewline();
    }

    if (checkForPegUpdate) {
      this.checkPricePeg();
    }
  };

  loadUpdateHistory = (): Q.Promise<any>  => {
    let deferred = Q.defer();
    readFromFile(this.config.updateLogFilename).then((log: string) => {
      deferred.resolve(log);
    }).catch((e) => {
      deferred.reject(e);
    });

    return deferred.promise;
  };

  getRate = (ratesObject: PricePegModel, searchSymbol: string): number => {
    let rate = 0;

    for(let i = 0; i < ratesObject.rates.length; i++) {
      let rateObj = ratesObject.rates[i];
      if(rateObj.currency == searchSymbol)
          rate = rateObj.rate;
    }

    return rate;
  };

  checkPricePeg = () => {
    let deferred = Q.defer();

    this.getPricePeg().then((currentValue: PricePegModel) => {
      if (this.config.logLevel.logPriceCheckEvents)
        logPegMessage(`Current peg value: ${JSON.stringify(currentValue)}`);

      if (this.sysRates == null) {
        if (this.config.logLevel.logPriceCheckEvents)
          logPegMessage(`No current value set, setting, setting first result as current value.`);

        this.sysRates = currentValue;
      }

      if (this.config.logLevel.logPriceCheckEvents)
        logPegMessageNewline();

      let newValue = this.convertToPricePeg();

      if (this.config.enablePegUpdateDebug) {
        this.setPricePeg(newValue, currentValue);
      } else {
        for(let key in this.conversionDataSources) {
          if(this.conversionDataSources[key].currencyConfig != null) {
            let currencyKey: string = this.conversionDataSources[key].getPegCurrency();
            let currentConversionRate = this.getRate(currentValue, currencyKey);
            let newConversionRate = this.getRate(newValue, currencyKey);
            let rateExists = true;

            try {
              if (currentConversionRate == null || newConversionRate == null) {
                rateExists = false;
                throw new Error(`No such rate: ${currencyKey}`);
              }

              let percentChange = getPercentChange(newConversionRate, currentConversionRate);

              if (this.config.logLevel.logPriceCheckEvents) {
                logPegMessage(`Checking price for ${currencyKey}: Current v. new = ${currentConversionRate}  v. ${newConversionRate} == ${percentChange}% change`);
              }

              percentChange = percentChange < 0 ? percentChange * -1 : percentChange; //convert neg percent to positive

              //if the price for any single currency as moved outside of the config'd range or the rate doesn't yet exist, update the peg.
              if (percentChange > (this.config.updateThresholdPercentage * 100)) {
                if (this.config.logLevel.logBlockchainEvents)
                  logPegMessage(`Attempting to update price peg, currency ${currencyKey} changed by ${percentChange}.`);

                this.setPricePeg(newValue, currentValue).then((result) => {
                  deferred.resolve(result);
                });
              } else {
                deferred.resolve();
              }
            }catch(e) {
              if(!rateExists) {
                if (this.config.logLevel.logBlockchainEvents)
                  logPegMessage(`Attempting to update price peg because new rate set doesn't match current`);

                //find the new entries and update them
                for(let i = 0; i < newValue.rates.length; i++)  {
                  if(newValue.rates[i].rate == null || isNaN(newValue.rates[i].rate)) {
                    newValue.rates[i].rate = 0;
                  }
                }

                this.setPricePeg(newValue, currentValue).then((result) => {
                  deferred.resolve(result);
                });
              }
            }
          }
        }
      }

    })

      .catch((err) => {
        logPegMessage("ERROR:" + err);
        deferred.reject(err);
      });

    return deferred.promise;
  };

  getPricePeg = () => {
    let deferred = Q.defer();

    if (!this.config.enableLivePegUpdates) {
      deferred.resolve(mockPeg);
    } else {
      this.client.aliasInfo(this.config.pegalias, (err, aliasinfo, resHeaders) => {
        if (err) {
          logPegMessage(`Error: ${err}`);
          return deferred.reject(err);
        }

        deferred.resolve(JSON.parse(aliasinfo.value));
      });
    }

    return deferred.promise;
  };

  setPricePeg = (newValue, oldValue) => {
    let deferred = Q.defer();

    //guard against updating the peg too rapidly
    let now = Date.now();
    let currentInterval = (1000 * 60 * 60 * 24) + (now - this.startTime);
    currentInterval = (currentInterval / (this.config.updatePeriod * 1000)) % 1; //get remainder of unfinished interval

    //see how many updates have happened in this period
    let currentIntervalStartTime = now - ((this.config.updatePeriod * 1000) * currentInterval);

    let updatesInThisPeriod = 0;
    if (this.config.logLevel.logBlockchainEvents)
      logPegMessage(`Attempting to update price peg if within safe parameters.`);

    updatesInThisPeriod += this.updateHistory.filter((item) => {
      return item.date > currentIntervalStartTime;
    }).length;

    if (updatesInThisPeriod <= this.config.maxUpdatesPerPeriod) {
      if (this.config.enableLivePegUpdates) {
        this.client.aliasUpdate(this.config.pegalias, this.config.pegalias_aliaspeg, JSON.stringify(newValue), (err, result, resHeaders) => {
          if (err) {
            logPegMessage(`ERROR: ${err}`);
            logPegMessageNewline();
            deferred.reject(err);
          } else {
            this.logUpdate(newValue, oldValue); //always store the pre-update value so it makes sense when displayed
            deferred.resolve(result);
          }
        });
      } else {
        this.logUpdate(newValue, oldValue);
        deferred.resolve(newValue);
      }
    } else {
      logPegMessage(`ERROR - Unable to update peg, max updates of [${this.config.maxUpdatesPerPeriod}] would be exceeded. Not updating peg.`);
      logPegMessageNewline();
      deferred.reject(null);
    }

    return deferred.promise;
  };

  logUpdate = (newValue, oldValue) => {
    //store prev value
    this.updateHistory.push({
      date: Date.now(),
      value: oldValue
    });

    //write updated history object to file
    writeToFile(this.config.updateLogFilename, JSON.stringify(this.updateHistory), false).then((result) => {
      if(this.config.logLevel.logUpdateLoggingEvents)
        logPegMessage("Update log history written to successfully");
    });

    this.sysRates = newValue;

    if (this.config.logLevel.logBlockchainEvents) {
      logPegMessage(`Price peg updated successfully.`);
      logPegMessageNewline();
    }
  };

  convertToPricePeg = (): PricePegModel => {
    const peg = {
      rates: []
    };

    for(let key in this.conversionDataSources) {
      if(this.conversionDataSources[key].currencyConfig != null) {
        peg.rates.push(this.conversionDataSources[key].getSYSPegFormat(this.conversionDataSources, this.fiatDataSource));
      }
    }

    return peg;
  };
};
