import {
    setUnion,
    arrayIntercalate,
    toReadonlyArray,
    iterableFirst,
    iterableFind,
    iterableSome,
    withDefault
} from "collection-utils";

import { TargetLanguage } from "../TargetLanguage";
import { Type, TypeKind, ClassType, ClassProperty, ArrayType, MapType, EnumType, UnionType } from "../Type";
import { nullableFromUnion, matchType, removeNullFromUnion, isNamedType, directlyReachableTypes } from "../TypeUtils";
import { NameStyle, Name, Namer, funPrefixNamer, DependencyName } from "../Naming";
import { Sourcelike, maybeAnnotated } from "../Source";
import { anyTypeIssueAnnotation, nullTypeIssueAnnotation } from "../Annotation";
import {
    legalizeCharacters,
    isAscii,
    isLetterOrUnderscoreOrDigit,
    stringEscape,
    NamingStyle,
    makeNameStyle
} from "../support/Strings";
import { defined, assertNever, panic, numberEnumValues } from "../support/Support";
import { ConvenienceRenderer, ForbiddenWordsInfo } from "../ConvenienceRenderer";
import { StringOption, EnumOption, BooleanOption, Option, getOptionValues, OptionValues } from "../RendererOptions";
import { assert } from "../support/Support";
import { Declaration } from "../DeclarationIR";
import { RenderContext } from "../Renderer";
import { getAccessorName } from "../AccessorNames";
import { enumCaseValues } from "../EnumValues";
import { minMaxValueForType, minMaxLengthForType, patternForType, MinMaxConstraint } from "../Constraints";

const pascalValue: [string, NamingStyle] = ["pascal-case", "pascal"];
const underscoreValue: [string, NamingStyle] = ["underscore-case", "underscore"];
const camelValue: [string, NamingStyle] = ["camel-case", "camel"];
const upperUnderscoreValue: [string, NamingStyle] = ["upper-underscore-case", "upper-underscore"];
const pascalUpperAcronymsValue: [string, NamingStyle] = ["pascal-case-upper-acronyms", "pascal-upper-acronyms"];
const camelUpperAcronymsValue: [string, NamingStyle] = ["camel-case-upper-acronyms", "camel-upper-acronyms"];

export const cPlusPlusOptions = {
    typeSourceStyle: new EnumOption(
        "source-style",
        "Source code generation type,  whether to generate single or multiple source files",
        [["single-source", true], ["multi-source", false]],
        "single-source",
        "secondary"
    ),
    includeLocation: new EnumOption(
        "include-location",
        "Whether json.hpp is to be located globally or locally",
        [["local-include", true], ["global-include", false]],
        "local-include",
        "secondary"
    ),
    codeFormat: new EnumOption(
        "code-format",
        "Generate classes with getters/setters, instead of structs",
        [["with-struct", false], ["with-getter-setter", true]],
        "with-getter-setter"
    ),
    justTypes: new BooleanOption("just-types", "Plain types only", false),
    namespace: new StringOption("namespace", "Name of the generated namespace(s)", "NAME", "quicktype"),
    enumType: new StringOption("enum-type", "Type of enum class", "NAME", "int", "secondary"),
    typeNamingStyle: new EnumOption<NamingStyle>("type-style", "Naming style for types", [
        pascalValue,
        underscoreValue,
        camelValue,
        upperUnderscoreValue,
        pascalUpperAcronymsValue,
        camelUpperAcronymsValue
    ]),
    memberNamingStyle: new EnumOption<NamingStyle>("member-style", "Naming style for members", [
        underscoreValue,
        pascalValue,
        camelValue,
        upperUnderscoreValue,
        pascalUpperAcronymsValue,
        camelUpperAcronymsValue
    ]),
    enumeratorNamingStyle: new EnumOption<NamingStyle>("enumerator-style", "Naming style for enumerators", [
        upperUnderscoreValue,
        underscoreValue,
        pascalValue,
        camelValue,
        pascalUpperAcronymsValue,
        camelUpperAcronymsValue
    ])
};

export class CPlusPlusTargetLanguage extends TargetLanguage {
    constructor(displayName: string = "C++", names: string[] = ["c++", "cpp", "cplusplus"], extension: string = "cpp") {
        super(displayName, names, extension);
    }

    protected getOptions(): Option<any>[] {
        return [
            cPlusPlusOptions.justTypes,
            cPlusPlusOptions.namespace,
            cPlusPlusOptions.codeFormat,
            cPlusPlusOptions.typeSourceStyle,
            cPlusPlusOptions.includeLocation,
            cPlusPlusOptions.typeNamingStyle,
            cPlusPlusOptions.memberNamingStyle,
            cPlusPlusOptions.enumeratorNamingStyle,
            cPlusPlusOptions.enumType
        ];
    }

    get supportsUnionsWithBothNumberTypes(): boolean {
        return true;
    }

    protected makeRenderer(
        renderContext: RenderContext,
        untypedOptionValues: { [name: string]: any }
    ): CPlusPlusRenderer {
        return new CPlusPlusRenderer(this, renderContext, getOptionValues(cPlusPlusOptions, untypedOptionValues));
    }
}

function constraintsForType(
    t: Type
): { minMax?: MinMaxConstraint; minMaxLength?: MinMaxConstraint; pattern?: string } | undefined {
    const minMax = minMaxValueForType(t);
    const minMaxLength = minMaxLengthForType(t);
    const pattern = patternForType(t);
    if (minMax === undefined && minMaxLength === undefined && pattern === undefined) return undefined;
    return { minMax, minMaxLength, pattern };
}

const legalizeName = legalizeCharacters(cp => isAscii(cp) && isLetterOrUnderscoreOrDigit(cp));

const keywords = [
    "alignas",
    "alignof",
    "and",
    "and_eq",
    "asm",
    "atomic_cancel",
    "atomic_commit",
    "atomic_noexcept",
    "auto",
    "bitand",
    "bitor",
    "bool",
    "break",
    "case",
    "catch",
    "char",
    "char16_t",
    "char32_t",
    "class",
    "compl",
    "concept",
    "const",
    "constexpr",
    "const_cast",
    "continue",
    "co_await",
    "co_return",
    "co_yield",
    "decltype",
    "default",
    "delete",
    "do",
    "double",
    "dynamic_cast",
    "else",
    "enum",
    "explicit",
    "export",
    "extern",
    "false",
    "float",
    "for",
    "friend",
    "goto",
    "if",
    "import",
    "inline",
    "int",
    "long",
    "module",
    "mutable",
    "namespace",
    "new",
    "noexcept",
    "not",
    "not_eq",
    "nullptr",
    "operator",
    "or",
    "or_eq",
    "private",
    "protected",
    "public",
    "register",
    "reinterpret_cast",
    "requires",
    "return",
    "short",
    "signed",
    "sizeof",
    "static",
    "static_assert",
    "static_cast",
    "struct",
    "switch",
    "synchronized",
    "template",
    "this",
    "thread_local",
    "throw",
    "true",
    "try",
    "typedef",
    "typeid",
    "typename",
    "union",
    "unsigned",
    "using",
    "virtual",
    "void",
    "volatile",
    "wchar_t",
    "while",
    "xor",
    "xor_eq",
    "override",
    "final",
    "transaction_safe",
    "transaction_safe_dynamic",
    "NULL"
];

/**
 * We can't use boost/std optional. They MUST have the declaration of
 * the given structure available, meaning we can't forward declare anything.
 * Which is bad as we have circles in Json schema, which require at least
 * forward declarability.
 * The next question, why isn't unique_ptr is enough here?
 * That problem relates to getter/setter. If using getter/setters we
 * can't/mustn't return a unique_ptr out of the class -> as that is the
 * sole reason why we have declared that as unique_ptr, so that only
 * the class owns it. We COULD return unique_ptr references, which practically
 * kills the uniqueness of the smart pointer -> hence we use shared_ptrs.
 */
const optionalType = "std::shared_ptr";

/**
 * To be able to support circles in multiple files -
 * e.g. class#A using class#B using class#A (obviously not directly,
 * but in vector or in variant) we can forward declare them;
 */
export enum IncludeKind {
    ForwardDeclare,
    Include
}

export enum GlobalNames {
    ClassMemberConstraints,
    ClassMemberConstraintException,
    ValueTooLowException,
    ValueTooHighException,
    ValueTooShortException,
    ValueTooLongException,
    InvalidPatternException,
    CheckConstraint
}

export enum MemberNames {
    MinValue,
    GetMinValue,
    SetMinValue,
    MaxValue,
    GetMaxValue,
    SetMaxValue,
    MinLength,
    GetMinLength,
    SetMinLength,
    MaxLength,
    GetMaxLength,
    SetMaxLength,
    Pattern,
    GetPattern,
    SetPattern
}

type ConstraintMember = {
    name: MemberNames;
    getter: MemberNames;
    setter: MemberNames;
    cppType: string;
    cppConstType?: string;
};

const constraintMembers: ConstraintMember[] = [
    { name: MemberNames.MinValue, getter: MemberNames.GetMinValue, setter: MemberNames.SetMinValue, cppType: "int" },
    { name: MemberNames.MaxValue, getter: MemberNames.GetMaxValue, setter: MemberNames.SetMaxValue, cppType: "int" },
    { name: MemberNames.MinLength, getter: MemberNames.GetMinLength, setter: MemberNames.SetMinLength, cppType: "int" },
    { name: MemberNames.MaxLength, getter: MemberNames.GetMaxLength, setter: MemberNames.SetMaxLength, cppType: "int" },
    {
        name: MemberNames.Pattern,
        getter: MemberNames.GetPattern,
        setter: MemberNames.SetPattern,
        cppType: "std::string",
        cppConstType: "const std::string &"
    }
];

export type IncludeRecord = {
    kind: IncludeKind | undefined /** How to include that */;
    typeKind: TypeKind | undefined /** What exactly to include */;
};

export type TypeRecord = {
    name: Name;
    type: Type;
    level: number;
    variant: boolean;
    forceInclude: boolean;
};

/**
 * We map each and every unique type to a include kind, e.g. how
 * to include the given type
 */
export type IncludeMap = Map<string, IncludeRecord>;

export type TypeContext = {
    needsForwardIndirection: boolean;
    needsOptionalIndirection: boolean;
    inJsonNamespace: boolean;
};

export class CPlusPlusRenderer extends ConvenienceRenderer {
    /**
     * For forward declaration practically
     */
    private _enumType: string;

    private _generatedFiles: Set<string>;
    private _currentFilename: string | undefined;
    private _allTypeNames: Set<string>;
    private readonly _gettersAndSettersForPropertyName = new Map<Name, [Name, Name, Name]>();
    private readonly _namespaceNames: ReadonlyArray<string>;
    private _memberNameStyle: NameStyle;
    private _namedTypeNameStyle: NameStyle;
    private _generatedGlobalNames: Map<GlobalNames, string>;
    private _generatedMemberNames: Map<MemberNames, string>;
    private _forbiddenGlobalNames: string[];
    private readonly _memberNamingFunction: Namer;

    protected readonly typeNamingStyle: NamingStyle;
    protected readonly enumeratorNamingStyle: NamingStyle;

    constructor(
        targetLanguage: TargetLanguage,
        renderContext: RenderContext,
        private readonly _options: OptionValues<typeof cPlusPlusOptions>
    ) {
        super(targetLanguage, renderContext);

        this._enumType = _options.enumType;
        this._namespaceNames = _options.namespace.split("::");

        this.typeNamingStyle = _options.typeNamingStyle;
        this._namedTypeNameStyle = makeNameStyle(this.typeNamingStyle, legalizeName);
        this.enumeratorNamingStyle = _options.enumeratorNamingStyle;

        this._memberNameStyle = makeNameStyle(_options.memberNamingStyle, legalizeName);
        this._memberNamingFunction = funPrefixNamer("members", this._memberNameStyle);
        this._gettersAndSettersForPropertyName = new Map();

        this._allTypeNames = new Set<string>();
        this._generatedFiles = new Set<string>();
        this._generatedGlobalNames = new Map();
        this._generatedMemberNames = new Map();
        this._forbiddenGlobalNames = [];

        this.setupGlobalNames();
    }

    protected lookupGlobalName(type: GlobalNames): string {
        return defined(this._generatedGlobalNames.get(type));
    }

    protected lookupMemberName(type: MemberNames): string {
        return defined(this._generatedMemberNames.get(type));
    }

    protected addGlobalName(type: GlobalNames): void {
        const genName = this._namedTypeNameStyle(GlobalNames[type]);
        this._generatedGlobalNames.set(type, genName);
        this._forbiddenGlobalNames.push(genName);
    }

    protected addMemberName(type: MemberNames): void {
        this._generatedMemberNames.set(type, this._memberNameStyle(MemberNames[type]));
    }

    protected setupGlobalNames(): void {
        for (const v of numberEnumValues(GlobalNames)) {
            this.addGlobalName(v);
        }
        for (const v of numberEnumValues(MemberNames)) {
            this.addMemberName(v);
        }
    }

    protected forbiddenNamesForGlobalNamespace(): string[] {
        return [...keywords, ...this._forbiddenGlobalNames];
    }

    protected forbiddenForObjectProperties(_c: ClassType, _className: Name): ForbiddenWordsInfo {
        return { names: [], includeGlobalForbidden: true };
    }

    protected forbiddenForEnumCases(_e: EnumType, _enumName: Name): ForbiddenWordsInfo {
        return { names: [], includeGlobalForbidden: true };
    }

    protected makeNamedTypeNamer(): Namer {
        return funPrefixNamer("types", this._namedTypeNameStyle);
    }

    protected namerForObjectProperty(): Namer {
        return this._memberNamingFunction;
    }

    protected makeUnionMemberNamer(): null {
        return null;
    }

    protected makeEnumCaseNamer(): Namer {
        return funPrefixNamer("enumerators", makeNameStyle(this.enumeratorNamingStyle, legalizeName));
    }

    protected makeNamesForPropertyGetterAndSetter(
        _c: ClassType,
        _className: Name,
        _p: ClassProperty,
        _jsonName: string,
        name: Name
    ): [Name, Name, Name] {
        const getterName = new DependencyName(this._memberNamingFunction, name.order, lookup => `get_${lookup(name)}`);
        const mutableGetterName = new DependencyName(
            this._memberNamingFunction,
            name.order,
            lookup => `getMutable_${lookup(name)}`
        );
        const setterName = new DependencyName(this._memberNamingFunction, name.order, lookup => `set_${lookup(name)}`);
        return [getterName, mutableGetterName, setterName];
    }

    protected makePropertyDependencyNames(
        c: ClassType,
        className: Name,
        p: ClassProperty,
        jsonName: string,
        name: Name
    ): Name[] {
        const getterAndSetterNames = this.makeNamesForPropertyGetterAndSetter(c, className, p, jsonName, name);
        this._gettersAndSettersForPropertyName.set(name, getterAndSetterNames);
        return getterAndSetterNames;
    }

    protected emitInclude(global: boolean, name: Sourcelike): void {
        this.emitLine("#include ", global ? "<" : '"', name, global ? ">" : '"');
    }

    protected startFile(basename: Sourcelike, includeHelper: boolean = true): void {
        assert(this._currentFilename === undefined, "Previous file wasn't finished");
        if (basename !== undefined) {
            this._currentFilename = this.sourcelikeToString(basename);
        }

        if (this.leadingComments !== undefined) {
            this.emitCommentLines(this.leadingComments);
        } else if (!this._options.justTypes) {
            this.emitCommentLines([
                " To parse this JSON data, first install",
                "",
                "     Boost     http://www.boost.org",
                "     json.hpp  https://github.com/nlohmann/json",
                "",
                " Then include this file, and then do",
                ""
            ]);

            if (this._options.typeSourceStyle) {
                this.forEachTopLevel("none", (_, topLevelName) => {
                    this.emitLine(
                        "//     ",
                        this.ourQualifier(false),
                        topLevelName,
                        " data = nlohmann::json::parse(jsonString);"
                    );
                });
            } else {
                this.emitLine(
                    "//     ",
                    this.ourQualifier(false),
                    basename,
                    " data = nlohmann::json::parse(jsonString);"
                );
            }
        }
        this.ensureBlankLine();

        this.emitLine("#pragma once");
        this.ensureBlankLine();

        if (this.haveNamedUnions) {
            this.emitInclude(true, "boost/variant.hpp");
        }
        if (!this._options.justTypes) {
            if (!this._options.includeLocation) {
                this.emitInclude(true, "nlohmann/json.hpp");
            } else {
                this.emitInclude(false, "json.hpp");
            }

            if (includeHelper && !this._options.typeSourceStyle) {
                this.emitInclude(false, "helper.hpp");
            }
        }
        this.ensureBlankLine();
    }

    protected finishFile(): void {
        super.finishFile(defined(this._currentFilename));
        this._currentFilename = undefined;
    }

    protected get needsTypeDeclarationBeforeUse(): boolean {
        return true;
    }

    protected canBeForwardDeclared(t: Type): boolean {
        const kind = t.kind;
        return kind === "class";
    }

    protected emitDescriptionBlock(lines: string[]): void {
        this.emitCommentLines(lines, " * ", "/**", " */");
    }

    protected emitBlock(line: Sourcelike, withSemicolon: boolean, f: () => void, withIndent: boolean = true): void {
        this.emitLine(line, " {");
        this.preventBlankLine();
        if (withIndent) {
            this.indent(f);
        } else {
            f();
        }
        this.preventBlankLine();
        if (withSemicolon) {
            this.emitLine("};");
        } else {
            this.emitLine("}");
        }
    }

    protected emitNamespaces(namespaceNames: Iterable<string>, f: () => void): void {
        const namesArray = toReadonlyArray(namespaceNames);
        const first = namesArray[0];
        if (first === undefined) {
            f();
        } else {
            this.emitBlock(
                ["namespace ", first],
                false,
                () => this.emitNamespaces(namesArray.slice(1), f),
                namesArray.length === 1
            );
        }
    }

    protected cppTypeInOptional(nonNulls: ReadonlySet<Type>, ctx: TypeContext, withIssues: boolean): Sourcelike {
        if (nonNulls.size === 1) {
            return this.cppType(defined(iterableFirst(nonNulls)), ctx, withIssues);
        }
        const typeList: Sourcelike = [];
        for (const t of nonNulls) {
            if (typeList.length !== 0) {
                typeList.push(", ");
            }
            typeList.push(
                this.cppType(
                    t,
                    {
                        needsForwardIndirection: true,
                        needsOptionalIndirection: false,
                        inJsonNamespace: ctx.inJsonNamespace
                    },
                    withIssues
                )
            );
        }
        return ["boost::variant<", typeList, ">"];
    }

    protected variantType(u: UnionType, inJsonNamespace: boolean): Sourcelike {
        const [maybeNull, nonNulls] = removeNullFromUnion(u, true);
        assert(nonNulls.size >= 2, "Variant not needed for less than two types.");
        const indirection = maybeNull !== null;
        const variant = this.cppTypeInOptional(
            nonNulls,
            { needsForwardIndirection: !indirection, needsOptionalIndirection: !indirection, inJsonNamespace },
            true
        );
        if (!indirection) {
            return variant;
        }
        return [optionalType, "<", variant, ">"];
    }

    protected ourQualifier(inJsonNamespace: boolean): Sourcelike {
        return inJsonNamespace ? [arrayIntercalate("::", this._namespaceNames), "::"] : [];
    }

    protected jsonQualifier(inJsonNamespace: boolean): Sourcelike {
        return inJsonNamespace ? [] : "nlohmann::";
    }

    protected variantIndirection(needIndirection: boolean, typeSrc: Sourcelike): Sourcelike {
        if (!needIndirection) return typeSrc;
        return [optionalType, "<", typeSrc, ">"];
    }

    protected cppType(t: Type, ctx: TypeContext, withIssues: boolean): Sourcelike {
        const inJsonNamespace = ctx.inJsonNamespace;
        return matchType<Sourcelike>(
            t,
            _anyType =>
                maybeAnnotated(withIssues, anyTypeIssueAnnotation, [this.jsonQualifier(inJsonNamespace), "json"]),
            _nullType =>
                maybeAnnotated(withIssues, nullTypeIssueAnnotation, [this.jsonQualifier(inJsonNamespace), "json"]),
            _boolType => "bool",
            _integerType => "int64_t",
            _doubleType => "double",
            _stringType => "std::string",
            arrayType => [
                "std::vector<",
                this.cppType(
                    arrayType.items,
                    { needsForwardIndirection: false, needsOptionalIndirection: true, inJsonNamespace },
                    withIssues
                ),
                ">"
            ],
            classType =>
                this.variantIndirection(ctx.needsForwardIndirection && this.isForwardDeclaredType(classType), [
                    this.ourQualifier(inJsonNamespace),
                    this.nameForNamedType(classType)
                ]),
            mapType => [
                "std::map<std::string, ",
                this.cppType(
                    mapType.values,
                    { needsForwardIndirection: false, needsOptionalIndirection: true, inJsonNamespace },
                    withIssues
                ),
                ">"
            ],
            enumType => [this.ourQualifier(inJsonNamespace), this.nameForNamedType(enumType)],
            unionType => {
                const nullable = nullableFromUnion(unionType);
                if (nullable === null) return [this.ourQualifier(inJsonNamespace), this.nameForNamedType(unionType)];
                return [
                    optionalType,
                    "<",
                    this.cppType(
                        nullable,
                        { needsForwardIndirection: false, needsOptionalIndirection: false, inJsonNamespace },
                        withIssues
                    ),
                    ">"
                ];
            }
        );
    }

    /**
     * similar to cppType, it practically gathers all the generated types within
     * 't'. It also records, whether a given sub-type is part of a variant or not.
     */
    protected generatedTypes(isClassMember: boolean, theType: Type): TypeRecord[] {
        const result: TypeRecord[] = [];
        const recur = (forceInclude: boolean, isVariant: boolean, l: number, t: Type) => {
            if (t instanceof ArrayType) {
                recur(forceInclude, isVariant, l + 1, t.items);
            } else if (t instanceof ClassType) {
                result.push({
                    name: this.nameForNamedType(t),
                    type: t,
                    level: l,
                    variant: isVariant,
                    forceInclude: forceInclude
                });
            } else if (t instanceof MapType) {
                recur(forceInclude, isVariant, l + 1, t.values);
            } else if (t instanceof EnumType) {
                result.push({
                    name: this.nameForNamedType(t),
                    type: t,
                    level: l,
                    variant: isVariant,
                    forceInclude: false
                });
            } else if (t instanceof UnionType) {
                /**
                 * If we have a union as a class member and we see it as a "named union",
                 * we can safely include it as-is.
                 * HOWEVER if we define a union on its own, we must recurse into the
                 * typedefinition and include all subtypes.
                 */
                if (this.unionNeedsName(t) && isClassMember) {
                    /**
                     * This is NOT ENOUGH.
                     * We have a variant member in a class, e.g. defined with a boost::variant.
                     * The compiler can only compile the class if IT KNOWS THE SIZES
                     * OF ALL MEMBERS OF THE VARIANT.
                     * So it means that you must include ALL SUBTYPES (practically classes only)
                     * AS WELL
                     */
                    forceInclude = true;
                    result.push({
                        name: this.nameForNamedType(t),
                        type: t,
                        level: l,
                        variant: true,
                        forceInclude: forceInclude
                    });
                    /** intentional "fall-through", add all subtypes as well - but forced include */
                }

                const [hasNull, nonNulls] = removeNullFromUnion(t);
                isVariant = hasNull !== null;
                /** we need to collect all the subtypes of the union */
                for (const tt of nonNulls) {
                    recur(forceInclude, isVariant, l + 1, tt);
                }
            }
        };
        recur(false, false, 0, theType);
        return result;
    }

    protected constraintMember(jsonName: string): string {
        return this._memberNameStyle(jsonName + "Constraint");
    }

    protected emitMember(cppType: Sourcelike, name: Sourcelike): void {
        this.emitLine(cppType, " ", name, ";");
    }

    protected emitClassMembers(c: ClassType, constraints: Map<string, string> | undefined): void {
        if (this._options.codeFormat) {
            this.emitLine("private:");

            this.forEachClassProperty(c, "none", (name, jsonName, property) => {
                this.emitMember(
                    this.cppType(
                        property.type,
                        { needsForwardIndirection: true, needsOptionalIndirection: true, inJsonNamespace: false },
                        true
                    ),
                    name
                );
                if (constraints !== undefined && constraints.has(jsonName)) {
                    /** FIXME!!! NameStyle will/can collide with other Names */
                    const cnst = this.lookupGlobalName(GlobalNames.ClassMemberConstraints);
                    this.emitMember(cnst, this.constraintMember(jsonName));
                }
            });

            this.ensureBlankLine();
            this.emitLine("public:");
        }

        this.forEachClassProperty(c, "none", (name, jsonName, property) => {
            this.emitDescription(this.descriptionForClassProperty(c, jsonName));
            if (!this._options.codeFormat) {
                this.emitMember(
                    this.cppType(
                        property.type,
                        { needsForwardIndirection: true, needsOptionalIndirection: true, inJsonNamespace: false },
                        true
                    ),
                    name
                );
            } else {
                const [getterName, mutableGetterName, setterName] = defined(
                    this._gettersAndSettersForPropertyName.get(name)
                );
                const rendered = this.cppType(
                    property.type,
                    { needsForwardIndirection: true, needsOptionalIndirection: true, inJsonNamespace: false },
                    true
                );

                /**
                 * fix for optional type -> e.g. unique_ptrs can't be copied
                 * One might as why the "this->xxx = value". Simple if we have
                 * a member called 'value' value = value will screw up the compiler
                 */
                const checkConst = this.lookupGlobalName(GlobalNames.CheckConstraint);
                if (property.type instanceof UnionType && property.type.findMember("null") !== undefined) {
                    this.emitLine(rendered, " ", getterName, "() const { return ", name, "; }");
                    if (constraints !== undefined && constraints.has(jsonName)) {
                        this.emitLine(
                            "void ",
                            setterName,
                            "(",
                            rendered,
                            " value) { if (value) ",
                            checkConst,
                            '("',
                            name,
                            '", ',
                            this.constraintMember(jsonName),
                            ", *value); this->",
                            name,
                            " = value; }"
                        );
                    } else {
                        this.emitLine("void ", setterName, "(", rendered, " value) { this->", name, " = value; }");
                    }
                } else {
                    this.emitLine("const ", rendered, " & ", getterName, "() const { return ", name, "; }");
                    this.emitLine(rendered, " & ", mutableGetterName, "() { return ", name, "; }");
                    if (constraints !== undefined && constraints.has(jsonName)) {
                        this.emitLine(
                            "void ",
                            setterName,
                            "(const ",
                            rendered,
                            "& value) { ",
                            checkConst,
                            '("',
                            name,
                            '", ',
                            this.constraintMember(jsonName),
                            ", value); this->",
                            name,
                            " = value; }"
                        );
                    } else {
                        this.emitLine(
                            "void ",
                            setterName,
                            "(const ",
                            rendered,
                            "& value) { this->",
                            name,
                            " = value; }"
                        );
                    }
                }
                this.ensureBlankLine();
            }
        });
    }

    protected generateClassConstraints(c: ClassType): Map<string, string> | undefined {
        let res: Map<string, string> = new Map<string, string>();
        this.forEachClassProperty(c, "none", (_name, jsonName, property) => {
            const constraints = constraintsForType(property.type);
            if (constraints === undefined) return;
            const { minMax, minMaxLength, pattern } = constraints;
            // FIXME: Use an array for this
            let constrArg: string = "(";
            constrArg += minMax !== undefined && minMax[0] !== undefined ? minMax[0] : "boost::none";
            constrArg += ", ";
            constrArg += minMax !== undefined && minMax[1] !== undefined ? minMax[1] : "boost::none";
            constrArg += ", ";
            constrArg += minMaxLength !== undefined && minMaxLength[0] !== undefined ? minMaxLength[0] : "boost::none";
            constrArg += ", ";
            constrArg += minMaxLength !== undefined && minMaxLength[1] !== undefined ? minMaxLength[1] : "boost::none";
            constrArg += ", ";
            constrArg += pattern === undefined ? "boost::none" : 'std::string("' + pattern + '")';
            constrArg += ")";

            res.set(jsonName, this.constraintMember(jsonName) + constrArg);
        });

        return res.size === 0 ? undefined : res;
    }

    protected emitClass(c: ClassType, className: Name): void {
        this.emitDescription(this.descriptionForType(c));
        this.emitBlock([this._options.codeFormat ? "class " : "struct ", className], true, () => {
            const constraints = this.generateClassConstraints(c);
            if (this._options.codeFormat) {
                this.emitLine("public:");
                if (constraints === undefined) {
                    this.emitLine(className, "() = default;");
                } else {
                    this.emitLine(className, "() :");
                    let numEmits: number = 0;
                    constraints.forEach((initializer: string, _propName: string) => {
                        numEmits++;
                        this.indent(() => {
                            if (numEmits === constraints.size) {
                                this.emitLine(initializer);
                            } else {
                                this.emitLine(initializer, ",");
                            }
                        });
                    });
                    this.emitLine("{}");
                }

                this.emitLine("virtual ~", className, "() = default;");
                this.ensureBlankLine();
            }

            this.emitClassMembers(c, constraints);
        });
    }

    protected emitClassFunctions(c: ClassType, className: Name): void {
        const ourQualifier = this.ourQualifier(true);

        this.emitBlock(["inline void from_json(const json& _j, ", ourQualifier, className, "& _x)"], false, () => {
            this.forEachClassProperty(c, "none", (name, json, p) => {
                const [, , setterName] = defined(this._gettersAndSettersForPropertyName.get(name));
                const t = p.type;
                if (t instanceof UnionType) {
                    const [maybeNull, nonNulls] = removeNullFromUnion(t, true);
                    if (maybeNull !== null) {
                        if (this._options.codeFormat) {
                            this.emitLine(
                                "_x.",
                                setterName,
                                "( ",
                                ourQualifier,
                                "get_optional<",
                                this.cppTypeInOptional(
                                    nonNulls,
                                    {
                                        needsForwardIndirection: false,
                                        needsOptionalIndirection: false,
                                        inJsonNamespace: true
                                    },
                                    false
                                ),
                                '>(_j, "',
                                stringEscape(json),
                                '") );'
                            );
                        } else {
                            this.emitLine(
                                "_x.",
                                name,
                                " = ",
                                ourQualifier,
                                "get_optional<",
                                this.cppTypeInOptional(
                                    nonNulls,
                                    {
                                        needsForwardIndirection: false,
                                        needsOptionalIndirection: false,
                                        inJsonNamespace: true
                                    },
                                    false
                                ),
                                '>(_j, "',
                                stringEscape(json),
                                '");'
                            );
                        }
                        return;
                    }
                }
                if (t.kind === "null" || t.kind === "any") {
                    if (this._options.codeFormat) {
                        this.emitLine(
                            "_x.",
                            setterName,
                            "( ",
                            ourQualifier,
                            'get_untyped(_j, "',
                            stringEscape(json),
                            '") );'
                        );
                    } else {
                        this.emitLine("_x.", name, " = ", ourQualifier, 'get_untyped(_j, "', stringEscape(json), '");');
                    }
                    return;
                }
                const cppType = this.cppType(
                    t,
                    { needsForwardIndirection: true, needsOptionalIndirection: true, inJsonNamespace: true },
                    false
                );
                if (this._options.codeFormat) {
                    this.emitLine("_x.", setterName, '( _j.at("', stringEscape(json), '").get<', cppType, ">() );");
                } else {
                    this.emitLine("_x.", name, ' = _j.at("', stringEscape(json), '").get<', cppType, ">();");
                }
            });
        });
        this.ensureBlankLine();
        this.emitBlock(["inline void to_json(json& _j, const ", ourQualifier, className, "& _x)"], false, () => {
            this.emitLine("_j = json::object();");
            this.forEachClassProperty(c, "none", (name, json, _) => {
                const [getterName, ,] = defined(this._gettersAndSettersForPropertyName.get(name));
                if (this._options.codeFormat) {
                    this.emitLine('_j["', stringEscape(json), '"] = _x.', getterName, "();");
                } else {
                    this.emitLine('_j["', stringEscape(json), '"] = _x.', name, ";");
                }
            });
        });
    }

    protected emitEnum(e: EnumType, enumName: Name): void {
        const caseNames: Sourcelike[] = [];
        const enumValues = enumCaseValues(e, this.targetLanguage.name);

        this.forEachEnumCase(e, "none", (name, jsonName) => {
            if (caseNames.length > 0) caseNames.push(", ");
            caseNames.push(name);

            if (enumValues !== undefined) {
                const [enumValue] = getAccessorName(enumValues, jsonName);
                if (enumValue !== undefined) {
                    caseNames.push(" = ", enumValue.toString());
                }
            }
        });
        this.emitDescription(this.descriptionForType(e));
        this.emitLine("enum class ", enumName, " : ", this._enumType, " { ", caseNames, " };");
    }

    protected emitUnionTypedefs(u: UnionType, unionName: Name): void {
        this.emitLine("typedef ", this.variantType(u, false), " ", unionName, ";");
    }

    protected emitUnionFunctions(u: UnionType): void {
        const functionForKind: [string, string][] = [
            ["bool", "is_boolean"],
            ["integer", "is_number_integer"],
            ["double", "is_number"],
            ["string", "is_string"],
            ["class", "is_object"],
            ["map", "is_object"],
            ["array", "is_array"],
            ["enum", "is_string"]
        ];
        const nonNulls = removeNullFromUnion(u, true)[1];
        const variantType = this.cppTypeInOptional(
            nonNulls,
            { needsForwardIndirection: false, needsOptionalIndirection: false, inJsonNamespace: true },
            false
        );

        this.emitBlock(["inline void from_json(const json& _j, ", variantType, "& _x)"], false, () => {
            let onFirst = true;
            for (const [kind, func] of functionForKind) {
                const typeForKind = iterableFind(nonNulls, t => t.kind === kind);
                if (typeForKind === undefined) continue;
                this.emitLine(onFirst ? "if" : "else if", " (_j.", func, "())");
                this.indent(() => {
                    this.emitLine(
                        "_x = _j.get<",
                        this.cppType(
                            typeForKind,
                            { needsForwardIndirection: true, needsOptionalIndirection: true, inJsonNamespace: true },
                            false
                        ),
                        ">();"
                    );
                });
                onFirst = false;
            }
            this.emitLine('else throw "Could not deserialize";');
        });
        this.ensureBlankLine();
        this.emitBlock(["inline void to_json(json& _j, const ", variantType, "& _x)"], false, () => {
            this.emitBlock("switch (_x.which())", false, () => {
                let i = 0;
                for (const t of nonNulls) {
                    this.emitLine("case ", i.toString(), ":");
                    this.indent(() => {
                        this.emitLine(
                            "_j = boost::get<",
                            this.cppType(
                                t,
                                {
                                    needsForwardIndirection: true,
                                    needsOptionalIndirection: true,
                                    inJsonNamespace: true
                                },
                                false
                            ),
                            ">(_x);"
                        );
                        this.emitLine("break;");
                    });
                    i++;
                }
                this.emitLine('default: throw "Input JSON does not conform to schema";');
            });
        });
    }

    protected emitEnumFunctions(e: EnumType, enumName: Name): void {
        const ourQualifier = this.ourQualifier(true);

        this.emitBlock(["inline void from_json(const json& _j, ", ourQualifier, enumName, "& _x)"], false, () => {
            let onFirst = true;
            this.forEachEnumCase(e, "none", (name, jsonName) => {
                const maybeElse = onFirst ? "" : "else ";
                this.emitLine(
                    maybeElse,
                    'if (_j == "',
                    stringEscape(jsonName),
                    '") _x = ',
                    ourQualifier,
                    enumName,
                    "::",
                    name,
                    ";"
                );
                onFirst = false;
            });
            this.emitLine('else throw "Input JSON does not conform to schema";');
        });
        this.ensureBlankLine();
        this.emitBlock(["inline void to_json(json& _j, const ", ourQualifier, enumName, "& _x)"], false, () => {
            this.emitBlock("switch (_x)", false, () => {
                this.forEachEnumCase(e, "none", (name, jsonName) => {
                    this.emitLine(
                        "case ",
                        ourQualifier,
                        enumName,
                        "::",
                        name,
                        ': _j = "',
                        stringEscape(jsonName),
                        '"; break;'
                    );
                });
                this.emitLine('default: throw "This should not happen";');
            });
        });
    }

    protected emitTopLevelTypedef(t: Type, name: Name): void {
        this.emitLine(
            "typedef ",
            this.cppType(
                t,
                { needsForwardIndirection: true, needsOptionalIndirection: true, inJsonNamespace: false },
                true
            ),
            " ",
            name,
            ";"
        );
    }

    protected emitAllUnionFunctions(): void {
        this.forEachUniqueUnion(
            "interposing",
            u =>
                this.sourcelikeToString(
                    this.cppTypeInOptional(
                        removeNullFromUnion(u, true)[1],
                        { needsForwardIndirection: false, needsOptionalIndirection: false, inJsonNamespace: true },
                        false
                    )
                ),
            (u: UnionType) => this.emitUnionFunctions(u)
        );
    }

    protected emitOptionalHelpers(): void {
        this.emitLine("template <typename T>");
        this.emitBlock(["struct adl_serializer<", optionalType, "<T>>"], true, () => {
            this.emitBlock(["static void to_json(json& j, const ", optionalType, "<T>& opt)"], false, () => {
                this.emitLine("if (!opt) j = nullptr; else j = *opt;");
            });

            this.ensureBlankLine();

            this.emitBlock(["static ", optionalType, "<T> from_json(const json& j)"], false, () => {
                this.emitLine(
                    `if (j.is_null()) return std::unique_ptr<T>(); else return std::unique_ptr<T>(new T(j.get<T>()));`
                );
            });
        });
    }

    protected emitDeclaration(decl: Declaration): void {
        if (decl.kind === "forward") {
            if (this._options.codeFormat) {
                this.emitLine("class ", this.nameForNamedType(decl.type), ";");
            } else {
                this.emitLine("struct ", this.nameForNamedType(decl.type), ";");
            }
        } else if (decl.kind === "define") {
            const t = decl.type;
            const name = this.nameForNamedType(t);
            if (t instanceof ClassType) {
                this.emitClass(t, name);
            } else if (t instanceof EnumType) {
                this.emitEnum(t, name);
            } else if (t instanceof UnionType) {
                this.emitUnionTypedefs(t, name);
            } else {
                return panic(`Cannot declare type ${t.kind}`);
            }
        } else {
            return assertNever(decl.kind);
        }
    }

    protected emitGetterSetter(t: string, getterName: string, setterName: string, memberName: string): void {
        this.emitLine("void ", setterName, "(", t, " ", memberName, ") { this->", memberName, " = ", memberName, "; }");
        this.emitLine("auto ", getterName, "() const { return ", memberName, "; }");
    }

    protected emitConstraintClasses(): void {
        const getterMinValue = this.lookupMemberName(MemberNames.GetMinValue);
        const getterMaxValue = this.lookupMemberName(MemberNames.GetMaxValue);
        const getterMinLength = this.lookupMemberName(MemberNames.GetMinLength);
        const getterMaxLength = this.lookupMemberName(MemberNames.GetMaxLength);
        const getterPattern = this.lookupMemberName(MemberNames.GetPattern);
        const classConstraint = this.lookupGlobalName(GlobalNames.ClassMemberConstraints);

        this.emitBlock(["class ", classConstraint], true, () => {
            this.emitLine("private:");
            for (const member of constraintMembers) {
                this.emitMember(["boost::optional<", member.cppType, ">"], this.lookupMemberName(member.name));
            }
            this.ensureBlankLine();
            this.emitLine("public:");
            this.emitLine(classConstraint, "(");
            this.indent(() => {
                this.iterableForEach(constraintMembers, ({ name, cppType }, pos) => {
                    const comma = pos === "first" || pos === "middle" ? "," : [];
                    this.emitLine("boost::optional<", cppType, "> ", this.lookupMemberName(name), comma);
                });
            });

            const args = constraintMembers.map(({ name }) => {
                const member = this.lookupMemberName(name);
                return [member, "(", member, ")"];
            });
            this.emitLine(") : ", arrayIntercalate([", "], args), " {}");

            this.emitLine(classConstraint, "() = default;");
            this.emitLine("virtual ~", classConstraint, "() = default;");
            for (const member of constraintMembers) {
                this.ensureBlankLine();
                this.emitGetterSetter(
                    withDefault(member.cppConstType, member.cppType),
                    this.lookupMemberName(member.getter),
                    this.lookupMemberName(member.setter),
                    this.lookupMemberName(member.name)
                );
            }
        });
        this.ensureBlankLine();

        const classConstEx = this.lookupGlobalName(GlobalNames.ClassMemberConstraintException);
        this.emitBlock(["class ", classConstEx, " : public std::runtime_error"], true, () => {
            this.emitLine("public:");
            this.emitLine(classConstEx, "(const std::string& msg) : std::runtime_error(msg) {}");
        });
        this.ensureBlankLine();

        const exceptions: GlobalNames[] = [
            GlobalNames.ValueTooLowException,
            GlobalNames.ValueTooHighException,
            GlobalNames.ValueTooShortException,
            GlobalNames.ValueTooLongException,
            GlobalNames.InvalidPatternException
        ];

        for (const ex of exceptions) {
            const name = this.lookupGlobalName(ex);
            this.emitBlock(["class ", name, " : public ", classConstEx], true, () => {
                this.emitLine("public:");
                this.emitLine(name, "(const std::string& msg) : ", classConstEx, "(msg) {}");
            });
            this.ensureBlankLine();
        }

        const checkConst = this.lookupGlobalName(GlobalNames.CheckConstraint);
        this.emitBlock(
            ["void ", checkConst, "(const std::string & name, const ", classConstraint, " & c, int64_t value)"],
            false,
            () => {
                this.emitBlock(
                    ["if (c.", getterMinValue, "() != boost::none && value < *c.", getterMinValue, "())"],
                    false,
                    () => {
                        this.emitLine(
                            "throw ",
                            this.lookupGlobalName(GlobalNames.ValueTooLowException),
                            ' ("Value too low for "+ name + " (" + std::to_string(value)+ "<"+std::to_string(*c.',
                            getterMinValue,
                            '())+")");'
                        );
                    }
                );
                this.ensureBlankLine();

                this.emitBlock(
                    ["if (c.", getterMaxValue, "() != boost::none && value > *c.", getterMaxValue, "())"],
                    false,
                    () => {
                        this.emitLine(
                            "throw ",
                            this.lookupGlobalName(GlobalNames.ValueTooHighException),
                            ' ("Value too high for "+name+" (" + std::to_string(value)+ ">"+std::to_string(*c.',
                            getterMaxValue,
                            '())+")");'
                        );
                    }
                );
                this.ensureBlankLine();
            }
        );
        this.ensureBlankLine();

        this.emitBlock(
            [
                "void ",
                checkConst,
                "(const std::string & name, const ",
                classConstraint,
                " & c, const std::string & value)"
            ],
            false,
            () => {
                this.emitBlock(
                    ["if (c.", getterMinLength, "() != boost::none && value.length() < *c.", getterMinLength, "())"],
                    false,
                    () => {
                        this.emitLine(
                            "throw ",
                            this.lookupGlobalName(GlobalNames.ValueTooShortException),
                            ' ("Value too short for "+name+" (" + std::to_string(value.length())+ "<"+std::to_string(*c.',
                            getterMinLength,
                            '())+")");'
                        );
                    }
                );
                this.ensureBlankLine();

                this.emitBlock(
                    ["if (c.", getterMaxLength, "() != boost::none && value.length() > *c.", getterMaxLength, "())"],
                    false,
                    () => {
                        this.emitLine(
                            "throw ",
                            this.lookupGlobalName(GlobalNames.ValueTooLongException),
                            ' ("Value too long for "+name+" (" + std::to_string(value.length())+ ">"+std::to_string(*c.',
                            getterMaxLength,
                            '())+")");'
                        );
                    }
                );
                this.ensureBlankLine();

                this.emitBlock(["if (c.", getterPattern, "() != boost::none)"], false, () => {
                    this.emitLine("std::smatch result;");
                    this.emitLine("std::regex_search(value, result, std::regex( *c.", getterPattern, "() ));");
                    this.emitBlock(["if (result.empty())"], false, () => {
                        this.emitLine(
                            "throw ",
                            this.lookupGlobalName(GlobalNames.InvalidPatternException),
                            ' ("Value doesn\'t match pattern for "+name+" (" + value+ "!="+*c.',
                            getterPattern,
                            '()+")");'
                        );
                    });
                });
                this.ensureBlankLine();
            }
        );
    }

    protected emitHelperFunctions(): void {
        if (
            this._options.codeFormat &&
            iterableSome(this.typeGraph.allTypesUnordered(), t => constraintsForType(t) !== undefined)
        ) {
            this.emitConstraintClasses();
            this.ensureBlankLine();
        }

        this.emitBlock(["inline json get_untyped(const json &j, const char *property)"], false, () => {
            this.emitBlock(["if (j.find(property) != j.end())"], false, () => {
                this.emitLine("return j.at(property).get<json>();");
            });
            this.emitLine("return json();");
        });

        this.ensureBlankLine();

        if (this.haveUnions) {
            this.emitLine("template <typename T>");
            this.emitBlock(
                ["inline ", optionalType, "<T> get_optional(const json &j, const char *property)"],
                false,
                () => {
                    this.emitBlock(["if (j.find(property) != j.end())"], false, () => {
                        this.emitLine("return j.at(property).get<", optionalType, "<T>>();");
                    });
                    this.emitLine("return ", optionalType, "<T>();");
                }
            );

            this.ensureBlankLine();
        }
    }

    protected emitExtraIncludes(): void {
        if (this._options.codeFormat) {
            this.emitInclude(true, `boost/optional.hpp`);
            this.emitInclude(true, `stdexcept`);
            this.emitInclude(true, `regex`);
        }
    }

    protected emitHelper(): void {
        this.startFile("helper.hpp", false);

        this.emitExtraIncludes();

        this.emitInclude(true, `sstream`);
        this.ensureBlankLine();
        this.emitNamespaces(this._namespaceNames, () => {
            this.emitLine("using nlohmann::json;");
            this.ensureBlankLine();
            this.emitHelperFunctions();
        });

        if (this.haveUnions) {
            this.ensureBlankLine();
            this.emitNamespaces(["nlohmann"], () => {
                this.emitOptionalHelpers();
            });
        }

        this.finishFile();
    }

    protected emitTypes(): void {
        if (!this._options.justTypes) {
            this.emitLine("using nlohmann::json;");
            this.ensureBlankLine();
            this.emitHelperFunctions();
        }
        this.forEachDeclaration("interposing", decl => this.emitDeclaration(decl));
        if (this._options.justTypes) return;
        this.forEachTopLevel(
            "leading",
            (t: Type, name: Name) => this.emitTopLevelTypedef(t, name),
            t => this.namedTypeToNameForTopLevel(t) === undefined
        );
    }

    protected emitGenerators(): void {
        let didEmit: boolean = false;
        const gathered = this.gatherSource(() =>
            this.emitNamespaces(this._namespaceNames, () => {
                didEmit = this.forEachTopLevel(
                    "none",
                    (t: Type, name: Name) => this.emitTopLevelTypedef(t, name),
                    t => this.namedTypeToNameForTopLevel(t) === undefined
                );
            })
        );
        if (didEmit) {
            this.emitGatheredSource(gathered);
            this.ensureBlankLine();
        }

        if (!this._options.justTypes && this.haveNamedTypes) {
            this.emitNamespaces(["nlohmann"], () => {
                this.forEachObject("leading-and-interposing", (c: ClassType, className: Name) =>
                    this.emitClassFunctions(c, className)
                );

                this.forEachEnum("leading-and-interposing", (e: EnumType, enumName: Name) =>
                    this.emitEnumFunctions(e, enumName)
                );

                if (this.haveUnions) {
                    this.emitAllUnionFunctions();
                }
            });
        }
    }

    protected emitSingleSourceStructure(proposedFilename: string): void {
        this.startFile(proposedFilename);
        this._generatedFiles.add(proposedFilename);

        this.emitExtraIncludes();

        if (this._options.justTypes) {
            this.emitTypes();
        } else {
            if (!this._options.justTypes && this.haveNamedTypes && this.haveUnions) {
                this.emitNamespaces(["nlohmann"], () => {
                    if (this.haveUnions) {
                        this.emitOptionalHelpers();
                    }
                });
                this.ensureBlankLine();
            }
            this.emitNamespaces(this._namespaceNames, () => this.emitTypes());
        }

        this.ensureBlankLine();
        this.emitGenerators();

        this.finishFile();
    }

    protected updateIncludes(isClassMember: boolean, includes: IncludeMap, propertyType: Type, _defName: string): void {
        const propTypes = this.generatedTypes(isClassMember, propertyType);

        for (const t of propTypes) {
            const typeName = this.sourcelikeToString(t.name);

            let propRecord: IncludeRecord = { kind: undefined, typeKind: undefined };

            if (t.type instanceof ClassType) {
                /**
                 * Ok. We can NOT forward declare direct class members, e.g. a class type is included
                 * at level#0. HOWEVER if it is not a direct class member (e.g. std::shared_ptr<Class>),
                 * - level > 0 - then we can SURELY forward declare it.
                 */
                propRecord.typeKind = "class";
                propRecord.kind = t.level === 0 ? IncludeKind.Include : IncludeKind.ForwardDeclare;
                if (t.forceInclude) {
                    propRecord.kind = IncludeKind.Include;
                }
            } else if (t.type instanceof EnumType) {
                propRecord.typeKind = "enum";
                propRecord.kind = IncludeKind.ForwardDeclare;
            } else if (t.type instanceof UnionType) {
                propRecord.typeKind = "union";
                /** Recurse into the union */
                const [maybeNull] = removeNullFromUnion(t.type, true);
                if (maybeNull !== undefined) {
                    /** Houston this is a variant, include it */
                    propRecord.kind = IncludeKind.Include;
                } else {
                    if (t.forceInclude) {
                        propRecord.kind = IncludeKind.Include;
                    } else {
                        propRecord.kind = IncludeKind.ForwardDeclare;
                    }
                }
            }

            if (includes.has(typeName)) {
                const incKind = includes.get(typeName);
                /**
                 * If we already include the type as typed include,
                 * do not write it over with forward declare
                 */
                if (incKind !== undefined && incKind.kind === IncludeKind.ForwardDeclare) {
                    includes.set(typeName, propRecord);
                }
            } else {
                includes.set(typeName, propRecord);
            }
        }
    }

    protected emitIncludes(c: ClassType | UnionType | EnumType, defName: string): void {
        /**
         * Need to generate "includes", in terms 'c' has members, which
         * are defined by others
         */
        let includes: IncludeMap = new Map();

        if (c instanceof UnionType) {
            this.updateIncludes(false, includes, c, defName);
        } else if (c instanceof ClassType) {
            this.forEachClassProperty(c, "none", (_name, _jsonName, property) => {
                this.updateIncludes(true, includes, property.type, defName);
            });
        }

        if (includes.size !== 0) {
            let numForwards: number = 0;
            let numIncludes: number = 0;
            includes.forEach((rec: IncludeRecord, name: string) => {
                /** Don't bother including the one we are defining */
                if (name === defName) {
                    return;
                }

                if (rec.kind !== IncludeKind.ForwardDeclare) {
                    this.emitInclude(false, [name, ".hpp"]);
                    numIncludes++;
                } else {
                    numForwards++;
                }
            });

            if (numIncludes > 0) {
                this.ensureBlankLine();
            }

            if (numForwards > 0) {
                this.emitNamespaces(this._namespaceNames, () => {
                    includes.forEach((rec: IncludeRecord, name: string) => {
                        /** Don't bother including the one we are defining */
                        if (name === defName) {
                            return;
                        }

                        if (rec.kind !== IncludeKind.ForwardDeclare) {
                            return;
                        }

                        if (rec.typeKind === "class" || rec.typeKind === "union") {
                            if (this._options.codeFormat) {
                                this.emitLine("class ", name, ";");
                            } else {
                                this.emitLine("struct ", name, ";");
                            }
                        } else if (rec.typeKind === "enum") {
                            this.emitLine("enum class ", name, " : ", this._enumType, ";");
                        } else {
                            panic(`Invalid type "${rec.typeKind}" to forward declare`);
                        }
                    });
                });
            }

            this.ensureBlankLine();
        }
    }

    protected emitDefinition(d: ClassType | EnumType | UnionType, defName: Name): void {
        const name = this.sourcelikeToString(defName) + ".hpp";
        this.startFile(name, true);
        this._generatedFiles.add(name);

        this.emitIncludes(d, this.sourcelikeToString(defName));

        this.emitNamespaces(this._namespaceNames, () => {
            this.emitDescription(this.descriptionForType(d));
            this.ensureBlankLine();
            this.emitLine("using nlohmann::json;");
            this.ensureBlankLine();
            if (d instanceof ClassType) {
                this.emitClass(d, defName);
            } else if (d instanceof EnumType) {
                this.emitEnum(d, defName);
            } else if (d instanceof UnionType) {
                this.emitUnionTypedefs(d, defName);
            }
        });

        this.finishFile();
    }

    protected emitMultiSourceStructure(proposedFilename: string): void {
        if (!this._options.justTypes && this.haveNamedTypes) {
            this.emitHelper();

            this.startFile("Generators.hpp", true);

            this._allTypeNames.forEach(t => {
                this.emitInclude(false, [t, ".hpp"]);
            });

            this.ensureBlankLine();
            this.emitGenerators();

            this.finishFile();
        }

        this.forEachNamedType(
            "leading-and-interposing",
            (c: ClassType, n: Name) => {
                this.emitDefinition(c, n);
            },
            (e, n) => {
                this.emitDefinition(e, n);
            },
            (u, n) => {
                this.emitDefinition(u, n);
            }
        );

        /**
         * If for some reason we have not generated anything,
         * it means that a unnamed type has been generated - or nothing.
         */
        if (!this._generatedFiles.has(proposedFilename)) {
            if (!this.haveNamedTypes) {
                this.emitHelper();
            }

            this.startFile(proposedFilename);

            this._generatedFiles.forEach(f => {
                this.emitInclude(false, f);
            });

            this.emitNamespaces(this._namespaceNames, () => {
                this.forEachTopLevel(
                    "leading",
                    (t: Type, name: Name) => this.emitTopLevelTypedef(t, name),
                    t => this.namedTypeToNameForTopLevel(t) === undefined
                );
            });

            this.finishFile();
        }
    }

    protected emitSourceStructure(proposedFilename: string): void {
        this._generatedFiles.clear();

        /** Gather all the unique/custom types used by the schema */
        this._allTypeNames.clear();
        this.forEachDeclaration("none", decl => {
            const definedTypes = directlyReachableTypes<string>(decl.type, t => {
                if (isNamedType(t) && (t instanceof ClassType || t instanceof EnumType || t instanceof UnionType)) {
                    return new Set([
                        this.sourcelikeToString(
                            this.cppType(
                                t,
                                {
                                    needsForwardIndirection: false,
                                    needsOptionalIndirection: false,
                                    inJsonNamespace: false
                                },
                                true
                            )
                        )
                    ]);
                }

                return null;
            });

            this._allTypeNames = setUnion(definedTypes, this._allTypeNames);
        });

        if (this._options.typeSourceStyle) {
            this.emitSingleSourceStructure(proposedFilename);
        } else {
            this.emitMultiSourceStructure(proposedFilename);
        }
    }
}
