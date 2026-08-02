import XCTest
@testable import ModelRouterTray

final class ModelSelectorModelsTests: XCTestCase {
  private let models = [
    ModelSelectorEntry(
      slug: "opencode-go/kimi-k3", name: "Kimi K3", provider: "opencode-go",
      pickerVisibility: "list"),
    ModelSelectorEntry(
      slug: "opencode-go/kimi-k2.7-code", name: "Kimi K2.7 Code",
      provider: "opencode-go", pickerVisibility: "hide"),
    ModelSelectorEntry(
      slug: "opencode-free/big-pickle", name: "Big Pickle",
      provider: "opencode-free", pickerVisibility: "hide"),
  ]

  func testSearchAndFamilyGrouping() {
    let catalog = ModelSelectorCatalog(models: models, favorites: [])
    XCTAssertEqual(catalog.models(for: .sota, search: "").map(\.slug), ["opencode-go/kimi-k3"])
    XCTAssertEqual(catalog.models(for: .go, search: "k2.7").map(\.slug), ["opencode-go/kimi-k2.7-code"])
    XCTAssertEqual(catalog.models(for: .free, search: "").map(\.slug), ["opencode-free/big-pickle"])
    XCTAssertEqual(models[0].family, "Kimi")
  }

  func testFavoritesAreStableAndDeduplicated() {
    let catalog = ModelSelectorCatalog(
      models: models,
      favorites: [models[1].slug, models[1].slug]
    )
    XCTAssertEqual(catalog.favoriteModels.map(\.slug), [models[1].slug])
    XCTAssertEqual(catalog.models(for: .go, search: "").first?.slug, models[1].slug)
  }
}
