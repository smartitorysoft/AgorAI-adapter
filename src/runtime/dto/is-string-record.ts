import {
  registerDecorator,
  type ValidationArguments,
  type ValidationOptions,
} from 'class-validator'

/**
 * A plain object whose every value is a string.
 *
 * `config` and `storeSession` are `Record<string, string>` and class-validator
 * has no built-in for that shape — `@IsObject()` alone would happily accept
 * `{ apiKey: { nested: true } }` and hand it to an adapter that expects text.
 */
export function IsStringRecord(options?: ValidationOptions) {
  return (object: object, propertyName: string): void => {
    registerDecorator({
      name: 'isStringRecord',
      target: object.constructor,
      propertyName,
      options,
      validator: {
        validate(value: unknown): boolean {
          if (
            typeof value !== 'object' ||
            value === null ||
            Array.isArray(value)
          ) {
            return false
          }
          return Object.values(value).every(
            (entry) => typeof entry === 'string'
          )
        },
        defaultMessage(args: ValidationArguments): string {
          return `${args.property} must be an object whose values are all strings`
        },
      },
    })
  }
}
