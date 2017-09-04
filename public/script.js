window.onload = function() {
  var KEY_MAP = {
    "ENTER": 13
  };

  var ENTITY_MAP = {
    "japan": "Location:Japan",
    "samsung": "Manufacturer:Samsung",
    "sony": "Manufacturer:Sony",
    "lenovo": "Manufacturer:Lenovo",
    "korea": "Location:Korea",
    "korean": "Location:Korea",
    "apple": "Manufacturer:Apple",
    "google": "Manufacturer:Google",
    "america": "Location:USA",
    "usa": "Location:USA",
    "china": "Location:China"
  };

  var NUMBER_SUFFIX = {
    "k": 1000,
    "g": 1e6,
    "b": 1e9
  };

  // Construct predicate mapping
  var PREDICATE_MAPPING = {
    "under": "PRICE < ",
    "over": "PRICE > ",
    "manufactured by": "MADE_BY = ",
    "made by": "MADE_BY = ",
    "made in": "MADE_IN = ",
    "from": "MADE_BY = ",
    "in": "MADE_IN = "
  };

  var CONCEPT_MAPPING = {
    "phones": [ "PHONES", "SELECT * from PHONES" ],
    "and": [ "BOOLEAN_OP", "AND" ],
    "or": [ "BOOLEAN_OP", "OR" ]
  };

  var searchBox = document.getElementById("searchBox");

  function getAllIndexes(string, val) {
    var indexes = [], i = -1;
    while ((i = string.indexOf(val, i + 1)) !== -1){
        indexes.push(i);
    }
    return indexes;
  }

  function getMatchIndex(query, key) {
    if (key.indexOf(" ") !== -1) {
      return getAllIndexes(query, key);
    } else {
      var tokens = query.split(" ");
      var indices = [];
      var tokenLength = 0;
      tokens.forEach(function(token, i) {
        if (token === key) {
          indices.push(tokenLength);
        }
        tokenLength += token.length + 1;
      });
      return indices;
    }
  }

  function numberAnnotator(query) {
    var annotations = [];
    var tokens = query.split(" ");
    var tokenLength = 0;
    tokens.forEach(function(token) {
      if (!isNaN(Number(token))) {
        annotations.push({
          class: "NUMBER",
          category: "VALUE",
          token: token,
          value: parseFloat(token),
          start: tokenLength,
          end: tokenLength + token.length
        });
      } else {
        var regex = /([\d.]+)([kgb])/g;
        var matches = regex.exec(token);
        if (matches) {
          var num = parseFloat(matches[1]);
          var suffix = NUMBER_SUFFIX[matches[2]] || 1;
          annotations.push({
            class: "NUMBER",
            category: "VALUE",
            token: token,
            value: num * suffix,
            start: tokenLength,
            end: tokenLength + token.length
          });
        }
      }
      tokenLength += token.length + 1;
    });
    return annotations;
  }

  function predicateAnnotator(query) {
    var annotations = [];
    Object.keys(PREDICATE_MAPPING).forEach(function(key) {
      // If key contains whitespace, use exact match.
      // Otherwise match against tokens.
      var indices = getMatchIndex(query, key);
      indices.forEach(function(i) {
        annotations.push({
          class: "PREDICATE",
          category: "CONDITION",
          token: key,
          value: PREDICATE_MAPPING[key],
          start: i,
          end: i + key.length
        });
      });
    });
    return annotations;
  }

  function conceptAnnotator(query) {
    var annotations = [];
    Object.keys(CONCEPT_MAPPING).forEach(function(key) {
      var indices = getMatchIndex(query, key);
      indices.forEach(function(i) {
        var value = CONCEPT_MAPPING[key];
        annotations.push({
          class: "CONCEPT",
          category: value[0],
          value: value[1],
          token: key,
          start: i,
          end: i + key.length
        });
      });
    });
    return annotations;
  }

  function entityAnnotator(query) {
    var annotations = [];
    Object.keys(ENTITY_MAP).forEach(function(key) {
      var indices = getMatchIndex(query, key);
      indices.forEach(function(i) {
        annotations.push({
          class: "ENTITY",
          type: ENTITY_MAP[key].split(":")[0],
          category: "VALUE",
          token: key,
          value: "\"" + ENTITY_MAP[key].split(":")[1] + "\"",
          start: i,
          end: i + key.length
        });
      });
    });
    return annotations;
  }

  function annotate(query) {
    return numberAnnotator(query).concat(
      entityAnnotator(query)
    ).concat(
      predicateAnnotator(query)
    ).concat(
      conceptAnnotator(query)
    );
  }

  function findClosestSpans(annotations, annotation) {
    annotations = annotations.filter(function(a) {
      // Filter out annotations that overlap with given annotation when moving forward.
      return a.start >= annotation.end;
    });
    var closest = annotations[0];
    if (closest) {
      // Find next closest
      return [ closest ].concat(findClosestSpans(annotations.slice(1), closest));
    }
    return [];
  }

  function stitchAnnotations(annotations, query) {
    var parse = null;
    // Order annotations by start key
    annotations.sort(function(a, b) {
      return a.start < b.start ? - 1 : 1;
    });
    for (var i = 0; i < annotations.length; i++) {
      var annotation = annotations[i];
      var spans = [ annotation ].concat(findClosestSpans(annotations, annotation));
      var joined = spans.map(function(s) { return s.token; }).join(" ");
      if (joined === query) {
        parse = spans;
        break;
      };
    }
    return parse;
  };

  var PREDICATE_BY_END_NODE = {
    "Manufacturer": "MADE_BY = ",
    "Location": "MADE_IN = "
  };

  function connectConditionals(span) {
    if (span.class === "NUMBER") {
      return " LIMIT " + span.value;
    } else if (span.class === "ENTITY") {
      var value = span.value;
      var type = span.type;
      // For the given type, connect appropriate predicate
      return " WHERE " + PREDICATE_BY_END_NODE[type] + " " +  value;
    }
    return "";
  }

  function replaceAll(query, sequence) {
    while (query.indexOf(sequence) !== -1) {
      query = query.replace(sequence, "");
    }
    return query;
  }

  function removeDuplicateSequence(query, sequence) {
    var index = query.indexOf(sequence);
    if (index === -1) {
      return query;
    }
    var replaced = replaceAll(query, sequence);
    // Now insert at first index
    return replaced.slice(0, index) + sequence + replaced.slice(index);
  }

  function sanitizeClauses(query) {
    // Move LIMIT (\d+) to the end.
    var limitRegex = /(LIMIT\s\d+)/g;
    var matches = limitRegex.exec(query);
    if (matches) {
      query = query.replace(matches[1], "") + " " + matches[1];
    }
    return removeDuplicateSequence(removeDuplicateSequence(query, "WHERE"), "SELECT * from PHONES");
  }

  var combinatorialRules = [
    [ "PHONES", "PHONES CONDITIONALS", function(sems) { return sems[0] + " WHERE " + sems[1]; } ],
    [ "PHONES", "PHONES CONDITIONAL", function(sems) { return (sems[0].indexOf("WHERE") === -1) ? (sems[0] + " WHERE " + sems[1]) : (sems[0] + " AND " + sems[1]); } ],
    [ "CONDITIONAL", "CONDITION VALUE", function(sems) { return sems[0] + sems[1] } ],
    [ "CONDITIONAL", "CONDITION NUMBER", function(sems) { return sems[0] + sems[1] } ],
    [ "PHONES", "PHONES BOOLEAN_OP_CONDITIONAL_", function(sems) { return sems[0] + " " + sems[1][0] + " " + sems[1][1]; }],
    [ "BOOLEAN_OP_CONDITIONAL_", "BOOLEAN_OP CONDITIONAL", function(sems) { return [ sems[0], sems[1] ]; } ],
    [ "CONDITIONALS", "BOOLEAN_OP_CONDITIONAL_ CONDITIONAL", function(sems) { return [sems[1], sems[0][0], sems[0][1]].join(" ") } ],
    [ "CONDITIONALS", "CONDITIONAL CONDITIONAL", function(sems) { return sems[0] + " AND " + sems[1]; } ],
    [ "PHONES", "VALUE PHONES", function(sems, spans) { return sems[1] + connectConditionals(spans[0]) } ]
  ];

  var combinatorialRuleMapping = {};

  // Make a dict mapping for rhs
  combinatorialRules.forEach(function(rule) {
    combinatorialRuleMapping[rule[1]] = {
      lhs: rule[0],
      sems: rule[2]
    };
  });

  function reduceParseSpans(parseSpans, iteration) {
    iteration = iteration || 0;
    var reducedSpans = [];
    for (var i = 0; i <= parseSpans.length - 1;) {
      if (i === parseSpans.length - 1) {
        reducedSpans.push(parseSpans[i]);
        i ++;
      } else {
        var pairCategory = (parseSpans[i].category) + " " + parseSpans[i + 1].category;
        var rule = combinatorialRuleMapping[pairCategory];
        if (rule) {
          reducedSpans.push({
            category: rule.lhs,
            value: rule.sems([ parseSpans[i].value, parseSpans[i + 1].value ], [ parseSpans[i], parseSpans[i + 1] ]) 
          });
          i += 2;
        } else {
          reducedSpans.push(parseSpans[i]);
          i ++;
        }
      }
    }
    if (iteration >= 10) {
      return reducedSpans;
    } else {
      return reduceParseSpans(reducedSpans, iteration + 1);
    }
  }

  function formatTableData(response) {
    // Find a <table> element with id="myTable":
    var table = document.getElementById("results");

    // Clear its children!
    table.innerHTML = "";

    var headers = {};
    var headerNames = [];
    response.rows.forEach(function(row, index) {
      var tableRow = table.insertRow(index);
      Object.keys(row).filter(function(d) { return d!== "ID"; }).forEach(function(key, keyIndex) {
        if (!headers[key]) {
          headers[key] = keyIndex;
          headerNames[keyIndex] = key;
        }
        tableRow.insertCell(headers[key]).innerHTML = row[key];
      });
    });

  // Create an empty <thead> element and add it to the table:
    var header = table.createTHead();

    // Create an empty <tr> element and add it to the first position of <thead>:
    var headerRow = header.insertRow(0);
    headerNames.forEach(function(key) {
       var headerCell = document.createElement("TH");
       headerCell.innerHTML = key;
       headerRow.appendChild(headerCell);
    });
  }

  function fetchResults(query, callback) {
    var xhr = new XMLHttpRequest();
    xhr.open('POST', '/execute', true);
    xhr.setRequestHeader('Content-type', 'application/json');
    xhr.onreadystatechange = function () {
      if (xhr.readyState === 4) {
        if (xhr.status === 200) {
          callback(null, JSON.parse(xhr.responseText));
        } else {
          callback(xhr.statusText, null);
        }
      }
    };
    xhr.send(JSON.stringify({
      query: query
    }));
  }

  // Given a series of annotated tokens, get query.
  // Query => SELECT clause , order clause, condition clause.
  // Grouping or condition clauses follows ops in btw
  // If an or is detected, use OR, otherwise AND conditions.

  function parse(query) {
    // Find all annotations for query. Then stitch together annotated spans
    // to find a parse
    var annotations = annotate(query.toLowerCase());
    // Stich to find a suitable parse. We only consider a single candidate here
    var parseSpans = stitchAnnotations(annotations, query.toLowerCase());

    if (parseSpans) {
      var reducedSpans = reduceParseSpans(parseSpans);
      var query = reducedSpans.map(function (r) { return r.value }).join(" ");
      query = sanitizeClauses(query) + ";";
      document.getElementById("query").innerHTML = query;
      // Send it to server to execute and fetch results
      fetchResults(query, function(err, response) {
        // Response is a bunch of rows, format as table
        formatTableData(response);
      });
      
    }
    //
    // Execute against database.
    // 
  }

  function handleSearchInput(event) {
    var keyCode = event.keyCode;
    // Enter key
    if (keyCode === KEY_MAP.ENTER) {
      var value = searchBox.value;
      // Send to parser
      var query = parse(value);
      // Execute query and show results
      // var results = execute(query);
    }
  }

  searchBox.addEventListener("keydown", handleSearchInput);
};
