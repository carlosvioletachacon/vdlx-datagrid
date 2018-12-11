import dataTransform, {
    getAllColumnIndices,
    getDisplayIndices,
    getPartialExposedKey,
    generateCompositeKey
} from './data-transform';
import withScenarioData from './data-loader';
import Paginator from "./paginator";
import { getRowData } from './utils';

const SelectOptions = insightModules.load('components/autotable-select-options');

class Datagrid {
    constructor(root, gridOptions$, columnOptions$) {

        this.gridOptions$ = gridOptions$;
        this.columnOptions$ = columnOptions$;
        this.componentRoot = root;
        this.view = insight.getView();
        this.schema = this.view
            .getProject()
            .getModelSchema();

        const options = ko.unwrap(gridOptions$);

        this.table = this.createTable(options);

        this.paginatorControl = this.createPaginatorControl(this.componentRoot, this.table, options);

        this.buildTable();
    }

    buildTable() {
        const columnOptions$ = this.columnOptions$;
        const gridOptions$ = this.gridOptions$;
        const scenariosData$ = withScenarioData(columnOptions$);

        ko.pureComputed(() => {
            const gridOptions = ko.unwrap(gridOptions$());
            const columnOptions = columnOptions$();
            const scenariosData = scenariosData$();

            if (gridOptions && columnOptions && scenariosData) {
                this.setColumnsAndData(gridOptions, columnOptions, scenariosData);
            }
            return undefined;
        }).subscribe(_.noop);
    }

    createTable(options) {
        const tabulatorOptions = {
            pagination: options.pagination,
            paginationSize: options.paginationSize,
            paginationElement: options.paginationElement,
            layout: 'fitColumns',
            placeholder: 'Waiting for data',
            groupStartOpen: false,
            ajaxLoader: true,
            columns: [],
            height: '100%'
        };

        return new Tabulator(`#${options.tableId}`, tabulatorOptions);
    }

    createPaginatorControl(componentRoot, table, options) {
        if (!options.pagination) {
            return undefined;
        }

        const $componentRoot = $(componentRoot);
        const $footerToolBar = $componentRoot.find('.footer-toolbar');
        const paginatorControl = new Paginator(table);
        paginatorControl.appendTo($footerToolBar);
        return paginatorControl;
    }

    updatePaginator() {
        if (this.paginatorControl) {
            this.paginatorControl.updatePageIndicators();
        }
    }

    setColumnsAndData(gridOptions, columnOptions, scenariosData) {
        const table = this.table;
        const schema = this.schema;
        const indicesOptions = columnOptions.indicesOptions;
        const entitiesOptions = columnOptions.columnOptions;
        const allColumnIndices = getAllColumnIndices(schema, entitiesOptions);

        const setNameAndPosns = getDisplayIndices(allColumnIndices, entitiesOptions);

        const setNamePosnsAndOptions = _.map(setNameAndPosns, setNameAndPosn => ({
            ...setNameAndPosn,
            options: _.get(indicesOptions, `${setNameAndPosn.name}.${setNameAndPosn.position}`, {
                id: `${setNameAndPosn.name}_${setNameAndPosn.position}`
            })
        }));

        const allScenarios = _.uniq([scenariosData.defaultScenario].concat(_.values(scenariosData.scenarios)));

        const indicesColumns = _.map(setNamePosnsAndOptions, setNameAndPosn => {
            const {name, options} = setNameAndPosn;
            const entity = schema.getEntity(name);

            return {
                title: _.escape(String(options.title || entity.getAbbreviation() || name)),
                field: options.id,
                cssClass: 'expanding-cell-height',
                formatter: (cell) => SelectOptions.getLabel(schema, allScenarios, entity, cell.getValue())
            };
        });

        const columnsIds = [].concat(_.map(setNamePosnsAndOptions, 'options.id'), _.map(entitiesOptions, 'id'));

        const getRowDataForColumns = getRowData(columnsIds);

        const entitiesColumns = _.map(entitiesOptions, (entityOptions, columnNumber) => {
            const entity = schema.getEntity(entityOptions.name);

            const columnScenario = _.get(scenariosData.scenarios, entityOptions.id, scenariosData.defaultScenario);

            const modify = (change) => columnScenario.modify().setArrayElement(entityOptions.name, change).commit();

            const getRowKey = _.compose(
                (rowData) => {
                    const tableKeys = getPartialExposedKey(setNameAndPosns, rowData);
                    return generateCompositeKey(tableKeys, setNameAndPosns, allColumnIndices[columnNumber], entityOptions);
                }, 
                getRowDataForColumns
            );

            return _.assign({}, entityOptions, {
                title: _.escape(String(entityOptions.title || entity.getAbbreviation() || entityOptions.name)),
                field: entityOptions.id,
                cssClass: 'expanding-cell-height',
                formatter: (cell) => {
                    const keys = getRowKey(cell.getData());
                    return window.insight.Formatter.getFormattedLabel(entity, columnScenario, cell.getValue(), keys);
                },
                editor: 'input',
                cellEdited: (cell) => {
                    const keys = getRowKey(cell.getData());

                    modify({ key: keys, value: Number(cell.getValue()) })
                      .catch(err => {
                        debugger;
                      });
                }
            });
        });


        const overrides = gridOptions.overrides;
        const columns = _.map([].concat(indicesColumns, entitiesColumns), col => {
            if (!!overrides.columnFilter) {
                col.headerFilter = true;
            }
            return col;
        });

        const data = dataTransform(allColumnIndices, columns, entitiesColumns, setNamePosnsAndOptions, scenariosData, gridOptions.rowFilter)

        table.setColumns(columns);

        return table
            .setData(data)
            .then(() => {
                table.redraw();
                this.updatePaginator();
            })
            .catch((err) => {
                debugger;
            });
    }
}

export default Datagrid;
