import { DefaultNamingStrategy, NamingStrategyInterface } from 'typeorm';

function toSnake(str: string): string {
  return str
    .replace(/([A-Z])/g, (ch) => `_${ch.toLowerCase()}`)
    .replace(/^_/, '');
}

export class SnakeNamingStrategy
  extends DefaultNamingStrategy
  implements NamingStrategyInterface
{
  columnName(
    propertyName: string,
    customName: string | undefined,
    embeddedPrefixes: string[],
  ): string {
    const base = customName || toSnake(propertyName);
    return embeddedPrefixes.map(toSnake).join('_') + base;
  }

  relationName(propertyName: string): string {
    return toSnake(propertyName);
  }

  joinColumnName(relationName: string, referencedColumnName: string): string {
    return toSnake(`${relationName}_${referencedColumnName}`);
  }

  joinTableName(
    firstTableName: string,
    secondTableName: string,
    _firstPropertyName: string,
  ): string {
    return toSnake(`${firstTableName}_${secondTableName}`);
  }

  joinTableColumnName(
    tableName: string,
    propertyName: string,
    columnName?: string,
  ): string {
    return toSnake(`${tableName}_${columnName ?? propertyName}`);
  }
}
