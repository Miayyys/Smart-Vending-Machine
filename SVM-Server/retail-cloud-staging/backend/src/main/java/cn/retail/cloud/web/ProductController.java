package cn.retail.cloud.web;

import cn.retail.cloud.entity.Product;
import cn.retail.cloud.repository.ProductRepository;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/products")
public class ProductController {

    private final ProductRepository repo;
    public ProductController(ProductRepository repo){this.repo=repo;}

    @GetMapping
    public List<Product> all(){return repo.findAll();}

    @GetMapping("/{id}")
    public Product get(@PathVariable Long id){return repo.findById(id).orElse(null);}

    @PostMapping
    public Product create(@RequestBody Product p){
        return repo.save(p);
    }
}