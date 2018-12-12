const DataUtils = insightModules.load('utils/data-utils');
const createDenseData = insightModules.load('components/table/create-dense-data');
const createSparseData = insightModules.load('components/table/create-sparse-data');
const SelectOptions = insightModules.load('components/autotable-select-options');

export const getAllColumnIndices = _.curry((schema, columnOptions) => {
    return _.map(columnOptions, function (option) {
        return schema.getEntity(option.name).getIndexSets();
    });
}, 2);

/**
 * @typedef {{name: string, position: number}} SetNameAndPosition 
 */

/** @returns {SetNameAndPosition[]} */
export const getDisplayIndices = (columnIndices, columnOptions) => {
    var setCount = {};
    var numColumns = columnIndices.length;

    for (var i = 0; i < numColumns; i++) {
        const indices = columnIndices[i], options = columnOptions[i];
        const setPosns = DataUtils.getIndexPosns(indices);
        indices.forEach(function (setName, i) {
            const setPosn = setPosns[i];
            if (DataUtils.getFilterValue(options.filters, setName, setPosn) == null) {
                // i.e. if there is no filter, then this index is to be used
                const key = { name: setName, position: setPosn }, keyJson = JSON.stringify(key);
                setCount[keyJson] = (setCount[keyJson] || 0) + 1;
            }
        });
    }

    return _(setCount)
        .pick(function (count) {
            return count === numColumns;
        })
        .keys()
        .map(function (k) {
            return JSON.parse(k);
        })
        .value();
}

// Build a key from the index set columns of a row. This may be partial, if not all index sets are displayed in the row
export const getPartialExposedKey = (setNameAndPosns, rowData) => 
    // Assume index columns always start at the beginning of the rowData array
    rowData.slice(0, setNameAndPosns.length);

export const generateCompositeKey = function (setValues, setNameAndPosns, arrayIndices, arrayOptions) {
    const setPosns = DataUtils.getIndexPosns(arrayIndices);
    return arrayIndices.map(function (setName, i) {
        const setPosn = setPosns[i];
        const setIndex = _.findIndex(setNameAndPosns, { name: setName, position: setPosn });
        const filterValue = DataUtils.getFilterValue(arrayOptions.filters, setName, setPosn);
        if (setIndex !== -1) {
            return setValues[setIndex];
        } else if (filterValue != null) {
            return filterValue;
        } else {
            throw Error('Cannot generate table with incomplete index configuration. Missing indices: ' +
                setName + ' for entity: ' + arrayOptions.name);
        }
    });
};

const isSparse = (sets, arrays) => {
    const totalPossibleKeys = _.reduce(sets, function (memo, set) {
        return memo * set.length;
    }, 1);

    const totalCountOfArrayValues = _.reduce(arrays, function (memo, insightArray) {
        return memo + insightArray.size();
    }, 0);

    return (totalPossibleKeys * arrays.length > ((totalCountOfArrayValues * Math.log(totalCountOfArrayValues)) || 0));
};


export default (allColumnIndices, columns, columnOptions, setNamePosnsAndOptions, scenariosData, rowFilter) => {

    var defaultScenario = scenariosData.defaultScenario;
    const indexScenarios = _.uniq(_.map(_.map(columnOptions, 'id'), id =>
        _.get(scenariosData.scenarios, id, defaultScenario)
    ));

    const arrayIds = _.map(columnOptions, 'id');
    const setIds = _.map(setNamePosnsAndOptions, 'options.id');

    const arrays = _.filter(_.map(columnOptions, column => {
        try {
            return _.get(scenariosData.scenarios, column.id, defaultScenario).getArray(column.name)
        } catch (err) {
            return undefined;
        } 
    }));

    const sets = _.map(setNamePosnsAndOptions, setNameAndPosn => {
        return _(indexScenarios)
            .map(function (scenario) {
                return scenario.getSet(setNameAndPosn.name);
            })
            .flatten()
            .uniq()
            .value();
    });

    const schema = insight.getView().getProject().getModelSchema();

    const allSetValues = _.map(setNamePosnsAndOptions, (setNamePosnAndOption, i) => {
        return SelectOptions.generateSelectOptions(schema, indexScenarios, setNamePosnAndOption.name, sets[i]);
    });

    const createRow = _.partial(_.zipObject, setIds.concat(arrayIds));

    let data;
    if (isSparse(sets, arrays)) {
        // assume O(nlogn)
        data = createSparseData(arrays, setNamePosnsAndOptions, allColumnIndices, columnOptions, columns);
    } else {
        data = createDenseData(sets, arrays, setNamePosnsAndOptions, allColumnIndices, columnOptions, generateCompositeKey);
    }

    // row filtering
    if (_.isFunction(rowFilter)) {
        data = _.filter(data, (rowData) => {
            return rowFilter(
                rowData,
                getPartialExposedKey(setNamePosnsAndOptions, rowData)
            );
        });
    }


    return {data: _.map(data, createRow), allSetValues: allSetValues};
};