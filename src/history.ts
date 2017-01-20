import PricePeg from "./PricePeg";
import {CurrencyConversionType} from "./data/CurrencyConversion";
import {getCurrencyData, numberWithCommas} from "./data/Utils";
import {getConfig} from "./config";

export const getHistoryPage = (req, res, peg: PricePeg) => {
  const config = getConfig();
  const updateTime = (config.updateInterval / 60).toFixed(2).indexOf(".00") == -1 ? (config.updateInterval / 60).toFixed(2) : (config.updateInterval / 60);
  const formattedUpdateThreshold = (config.updateThresholdPercentage * 100).toString().indexOf(".") == -1 ? (config.updateThresholdPercentage * 100).toString() : (config.updateThresholdPercentage * 100).toString().substr(0, (config.updateThresholdPercentage * 100).toString().indexOf(".") + 4);

  res.writeHead(200, {'Content-Type': 'text/html'});
  res.write(`
    <!DOCTYPE html><html><head> 
    <link rel="stylesheet" href="https://maxcdn.bootstrapcdn.com/bootstrap/3.3.6/css/bootstrap.min.css" integrity="sha384-1q8mTJOASx8j1Au+a5WDVnPi2lkFfwwEAa8hDDdjZlpLegxhjVME1fgjWPGmkzs7" crossorigin="anonymous"> 
    <link rel="stylesheet" href="style.css">   
    <script   src="https://code.jquery.com/jquery-2.2.2.min.js"   integrity="sha256-36cp2Co+/62rEAAYHLmRCPIych47CvdM+uTBJwSzWjI="   crossorigin="anonymous"></script> 
    <!-- Latest compiled and minified JavaScript -->    
    <script src="https://maxcdn.bootstrapcdn.com/bootstrap/3.3.6/js/bootstrap.min.js" integrity="sha384-0mSbJDEHialfmuBBQP6A4Qrprq5OVfW37PRR3j5ELqxss1yVqOtnepnHVP9aJ7xS" crossorigin="anonymous"></script> 
    
    <meta charset="utf-8"> 
    <title>Syscoin Price Peg History</title> 
    <meta http-equiv="X-UA-Compatible" content="IE=edge"> 
    <meta name="viewport" content="width=device-width, initial-scale=1">
     
    <link rel="icon" href="http://i1.wp.com/syscoin.org/wp-content/uploads/2016/03/cropped-White-Logo-640x130.png?fit=32%2C32" sizes="32x32" /> 
    <link rel="icon" href="http://i1.wp.com/syscoin.org/wp-content/uploads/2016/03/cropped-White-Logo-640x130.png?fit=192%2C192" sizes="192x192" />  
    <link rel="apple-touch-icon-precomposed" href="http://i1.wp.com/syscoin.org/wp-content/uploads/2016/03/cropped-White-Logo-640x130.png?fit=180%2C180" /> 
    <meta name="msapplication-TileImage" content="http://i1.wp.com/syscoin.org/wp-content/uploads/2016/03/cropped-White-Logo-640x130.png?fit=270%2C270" /> 
     
    </head><body class="container" style="padding: 10px"> 
     
    <div class="jumbotron"> 
    <div style="text-align:center"><img src="syscoin_icon.png" width="200" height="200" style="" /></div>
    <p style="font-size:18px; text-align: center">
    The Syscoin Team price peg uses the "${config.pegalias}" alias on the Syscoin blockchain and is the default price peg for all items being sold on the 
    Syscoin Decentralized Marketplace. The price peg uses averages rates from Bittrex and Poloniex for each supported cryptocurrency, USD/BTC rates from Coinbase, and USD/Fiat rates from <a href="http://fixer.io">Fixer.io.</a> <br><br>
    The "${config.pegalias}" price peg is automatically updated when any of the supported currency's exchange rates change by +/- ${formattedUpdateThreshold}% of the current rates stored on the blockchain. This check is performed every ${updateTime} minutes. b
    
    For more information on how price pegging works in Syscoin please <a href="http://syscoin.org/faqs/price-pegging-work/">see the FAQ.</a><br><br>
    Values in the below are trimmed to 2 decimals. Full value can be seen in history here or on the blockchain. To support the Syscoin team price peg please send SYS to "${config.pegalias}", all funds are used to cover alias update costs.</p>
    
    <p class="disclaimer"><b>Disclaimer:</b> The Syscoin Team does its best to ensure the price peg is running properly 24/7/365 and that rates produced by the peg are accurate based on market rates.
    By using the Syscoin Team price peg you acknowledge this and release the team for any liability related to inaccuracies or erroneous peg values.</p>
    <div style="text-align: center">`);
  for (let i = 0; i < peg.sysRates.rates.length; i++) {
    let rate = peg.sysRates.rates[i];
    if(rate.currency == CurrencyConversionType.CRYPTO.SYS.symbol)
      continue;

    const formattedValue = rate.rate.toString().indexOf(".") == -1 ? numberWithCommas(rate.rate.toString()) : numberWithCommas(rate.rate.toString().substr(0, rate.rate.toString().indexOf(".") + 3));
    const currencyData = getCurrencyData(rate.currency);

    res.write(`<div style="padding: 10px; display: inline-block; text-align: center; margin: 0 auto">
                <h3><b>${rate.currency}/SYS:</b> ${formattedValue}</h3>
                <p style="font-size: 10px; font-style: italic">${formattedValue} Syscoin = 1 ${currencyData.label}</p>
              </div>`);
  }

  res.write(`</div>
    <hr><h4>Current Raw Value:</h4> 
    <textarea style="width:100%;height:70px">${JSON.stringify(peg.sysRates)}</textarea>
    </div> 
    
    <div class="panel panel-default"> 
    <div class="panel-heading"><h4>Update History:</h4></div> 
    <table class="table table-striped table-hover">  
    <thead>                         
    <tr> 
    <th width="1%"></th>                           
    <th width="20%">Date</th>                      
    <th>Value</th>                      
    </tr>                           
    </thead>                        
    <tbody> 
  `);

  for (let i = peg.updateHistory.length - 1; i >= 0; i--) {
    res.write(`<tr>                            
    <td><span class="glyphicon glyphicon-ok" /></td>      
    <td>${timeConverter(peg.updateHistory[i].date)}</td>      
    <td style="font-family: Lucida Console, monospace">${JSON.stringify(peg.updateHistory[i].value)}</td>      
    </tr>`);
  }
  res.write('</tbody></table></div>');

  res.write(`<div style="text-align: center; font-size: 11px;">Syscoin Price Peg Server ${config.version}</div>`);

  res.write('</body></html>');
  res.end();
};

export const timeConverter = (UNIX_timestamp: number) => {
  let a = new Date(UNIX_timestamp);
  let months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  let year = a.getFullYear();
  let month = months[a.getMonth()];
  let date = a.getDate();
  let hour = a.getHours();
  let min = a.getMinutes();
  let sec = a.getSeconds();
  //let time = date + ' ' + month + ' ' + year + ' ' + hour + ':' + min + ':' + sec ;
  let time = date + ' ' + month + ' ' + year + ' ' + formatAMPM(a);

  return time;
};

export const formatAMPM = (date) => {
  let hours = date.getHours();
  let minutes = date.getMinutes();
  let seconds = date.getSeconds();
  let ampm = hours >= 12 ? 'pm' : 'am';
  hours = hours % 12;
  hours = hours ? hours : 12; // the hour '0' should be '12'
  minutes = minutes < 10 ? '0' + minutes : minutes;
  let strTime = hours + ':' + minutes + ':' + seconds + ' ' + ampm;

  return strTime;
};

export default getHistoryPage;
